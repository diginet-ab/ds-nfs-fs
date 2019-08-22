// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'
import * as path from 'path'
import * as common from './common'
import { getDsFs } from '../fs'

async function rename_get_from_dir(call, reply, next) {
    var log = call.log

    log.debug('rename_get_from_dir(%s): entered', call.from.dir)

    try {
        var name = await call.fhdb.fhandle(call.from.dir)
    } catch (err) {
        log.warn(err, 'rename_get_from_dir(%s): fhandle notfound', call.from.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    call._from_dirname = name
    call._from_filename = path.join(name, call.from.name)
    log.debug('rename_get_from_dir(%s): done -> %s', call.from.dir, name)
    next()
}

async function rename_get_to_dir(call, reply, next) {
    var log = call.log

    log.debug('rename_get_to_dir(%s): entered', call.to.dir)

    try {
        var name = await call.fhdb.fhandle(call.to.dir)
    } catch (err) {
        log.warn(err, 'rename_get_to_dir(%s): fhandle notfound', call.to.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    call._to_dirname = name
    call._to_filename = path.join(name, call.to.name)
    log.debug('rename_get_to_dir(%s): done -> %s', call.to.dir, name)
    next()
}

function rename(call, reply, next) {
    var log = call.log

    log.debug('rename(%s -> %s): entered', call._from_filename, call._to_filename)
    getDsFs().rename(call._from_filename, call._to_filename, function(err) {
        if (err) {
            log.warn(err, 'rename(%s, %s): failed', call._from_filename, call._to_filename)
            reply.error(nfs.NFS3ERR_NOENT)
            next(false)
            return
        }

        // update the file handle
        call.fhdb.mv(call._from_filename, call._to_filename, function(d_err) {
            if (d_err) {
                log.warn(d_err, 'rename(%s, %s): mv fh failed', call._from_filename, call._to_filename)
                common.handle_error(d_err, call, reply, next)
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
