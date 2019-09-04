// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'
import * as path from 'path'
import * as common from './common'
import { Req } from '.';

async function rmdir_lookup_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('rmdir_lookup_dir(%s): entered', req._object.dir)

    try {
        var name = await req.fhdb.fhandle(req._object.dir)
    } catch (err) {
        log.warn(err, 'rmdir_lookup_dir(%s): fhandle notfound', req._object.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    req._dirname = name
    req._filename = path.join(name, req._object.name)
    log.debug('rmdir_lookup_dir(%s): done -> %s', req._object.dir, name)
    next()
}

function rmdir_stat_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('rmdir_stat_dir(%s): entered', req._filename)
    req.fs.lstat(req._filename, function(err, stats) {
        if (err) {
            log.warn(err, 'rmdir_stat_dir(%s): failed', req._filename)
            reply.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }
        if (!stats.isDirectory()) {
            log.warn(err, 'rmdir_stat_dir(%s): not a directory', req._filename)
            reply.error(nfs.NFS3ERR_NOTDIR)
            next(false)
            return
        }

        log.debug('rmdir_stat_dir(%s): done', req._filename)
        next()
    })
}

function rmdir(req: Req, reply, next) {
    var log = req.log

    log.debug('rmdir(%s): entered', req._filename)
    req.fs.rmdir(req._filename, function(err) {
        if (err && err.code !== 'ENOENT') {
            if (err.code === 'ENOTEMPTY') {
                log.info('rmdir(%s): directory not empty', req._filename)
            } else if (err.code === 'EEXIST') {
                // EEXIST seems to be what we actually get for not empty
                log.info('rmdir(%s): directory not empty', req._filename)
                err.code = 'ENOTEMPTY'
            } else {
                log.warn(err, 'rmdir(%s): failed', req._filename)
            }
            common.handle_error(err, req, reply, next)
            return
        }

        // delete file handle
        req.fhdb.del(req._filename, function(d_err) {
            if (d_err) {
                log.trace(d_err, 'rmdir(%s): del fh failed', req._filename)
                common.handle_error(d_err, req, reply, next)
            } else {
                log.debug('rmdir(%s): done', req._filename)
                reply.send()
                next()
            }
        })
    })
}

export default function chain() {
    return [rmdir_lookup_dir, rmdir_stat_dir, rmdir]
}
