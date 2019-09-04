// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'
import * as path from 'path'
import * as common from './common'
import { Req } from '.';

async function rename_get_from_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('rename_get_from_dir(%s): entered', req.from.dir)

    try {
        var name = await req.fhdb.fhandle(req.from.dir)
    } catch (err) {
        log.warn(err, 'rename_get_from_dir(%s): fhandle notfound', req.from.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    req._from_dirname = name
    req._from_filename = path.join(name, req.from.name)
    log.debug('rename_get_from_dir(%s): done -> %s', req.from.dir, name)
    next()
}

async function rename_get_to_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('rename_get_to_dir(%s): entered', req.to.dir)

    try {
        var name = await req.fhdb.fhandle(req.to.dir)
    } catch (err) {
        log.warn(err, 'rename_get_to_dir(%s): fhandle notfound', req.to.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    req._to_dirname = name
    req._to_filename = path.join(name, req.to.name)
    log.debug('rename_get_to_dir(%s): done -> %s', req.to.dir, name)
    next()
}

function rename(req: Req, reply, next) {
    var log = req.log

    log.debug('rename(%s -> %s): entered', req._from_filename, req._to_filename)
    req.fs.rename(req._from_filename, req._to_filename, function(err) {
        if (err) {
            log.warn(err, 'rename(%s, %s): failed', req._from_filename, req._to_filename)
            reply.error(nfs.NFS3ERR_NOENT)
            next(false)
            return
        }

        // update the file handle
        req.fhdb.mv(req._from_filename, req._to_filename, function(d_err) {
            if (d_err) {
                log.warn(d_err, 'rename(%s, %s): mv fh failed', req._from_filename, req._to_filename)
                common.handle_error(d_err, req, reply, next)
            } else {
                log.debug('rename: done')
                reply.send()
                next()
            }
        })
    })
}

export default function chain() {
    return [rename_get_from_dir, rename_get_to_dir, rename]
}
