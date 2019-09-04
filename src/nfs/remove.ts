// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'
import * as path from 'path'
import * as common from './common'
import { Req } from '.';

async function remove_lookup_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('remove_lookup_dir(%s): entered', req._object.dir)

    try {
        var name = await req.fhdb.fhandle(req._object.dir)
    } catch (err) {
        log.warn(err, 'remove_lookup_dir(%s): fhandle notfound', req._object.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    req._dirname = name
    req._filename = path.join(name, req._object.name)
    log.debug('remove_lookup_dir(%s): done -> %s', req._object.dir, name)
    next()
}

function remove_stat_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('remove_stat_dir(%s): entered', req._filename)
    req.fs.lstat(req._filename, function(err, stats) {
        if (err) {
            log.warn(err, 'remove_stat_dir(%s): failed', req._filename)
            reply.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }
        if (stats.isDirectory()) {
            log.warn(err, 'remove_stat_dir(%s): is a directory', req._filename)
            reply.error(nfs.NFS3ERR_NOTDIR)
            next(false)
            return
        }

        log.debug('remove_stat_dir(%s): done', req._filename)
        next()
    })
}

function remove(req: Req, reply, next) {
    var log = req.log

    log.debug('remove(%s): entered', req._filename)
    req.fs.unlink(req._filename, function(err) {
        if (err) {
            log.warn(err, 'remove(%s): failed', req._filename)
            common.handle_error(err, req, reply, next)
            return
        }

        // delete file handle
        req.fhdb.del(req._filename, function(d_err) {
            if (d_err) {
                log.trace(d_err, 'remove(%s): del fh failed', req._filename)
                common.handle_error(d_err, req, reply, next)
            } else {
                log.debug('remove(%s): done', req._filename)
                reply.send()
                next()
            }
        })
    })
}

export default function chain() {
    return [remove_lookup_dir, remove_stat_dir, remove]
}
