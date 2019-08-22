// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'
import * as path from 'path'
import * as common from './common'
import { getDsFs } from '../fs'

async function remove_lookup_dir(call, reply, next) {
    var log = call.log

    log.debug('remove_lookup_dir(%s): entered', call._object.dir)

    try {
        var name = await call.fhdb.fhandle(call._object.dir)
    } catch (err) {
        log.warn(err, 'remove_lookup_dir(%s): fhandle notfound', call._object.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    call._dirname = name
    call._filename = path.join(name, call._object.name)
    log.debug('remove_lookup_dir(%s): done -> %s', call._object.dir, name)
    next()
}

function remove_stat_dir(call, reply, next) {
    var log = call.log

    log.debug('remove_stat_dir(%s): entered', call._filename)
    getDsFs().lstat(call._filename, function(err, stats) {
        if (err) {
            log.warn(err, 'remove_stat_dir(%s): failed', call._filename)
            reply.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }
        if (stats.isDirectory()) {
            log.warn(err, 'remove_stat_dir(%s): is a directory', call._filename)
            reply.error(nfs.NFS3ERR_NOTDIR)
            next(false)
            return
        }

        log.debug('remove_stat_dir(%s): done', call._filename)
        next()
    })
}

function remove(call, reply, next) {
    var log = call.log

    log.debug('remove(%s): entered', call._filename)
    getDsFs().unlink(call._filename, function(err) {
        if (err) {
            log.warn(err, 'remove(%s): failed', call._filename)
            common.handle_error(err, call, reply, next)
            return
        }

        // delete file handle
        call.fhdb.del(call._filename, function(d_err) {
            if (d_err) {
                log.trace(d_err, 'remove(%s): del fh failed', call._filename)
                common.handle_error(d_err, call, reply, next)
            } else {
                log.debug('remove(%s): done', call._filename)
                reply.send()
                next()
            }
        })
    })
}

export default function chain() {
    return [remove_lookup_dir, remove_stat_dir, remove]
}
