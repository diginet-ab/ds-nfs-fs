// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as assert from 'assert-plus'
import * as nfs from '@diginet/nfs'
import { getDsFs } from '../fs'

///-- API

export async function fhandle_to_filename(call, reply, next) {
    var fhandle = call.fhandle || call.object
    var log = call.log

    log.debug('fhandle_to_filename(%s): entered', fhandle)
    assert.string(fhandle, 'call.fhandle')

    try {
        var name = await call.fhdb.fhandle(fhandle)
    } catch (err) {
        log.warn(err, 'fhandle_to_filename(%s): failed', fhandle)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }
    call._filename = name
    log.debug('fhandle_to_filename(%s): done: %s', fhandle, name)
    next()
}

export function handle_error(err, req, res, next) {
    switch (err.code) {
        case 'EACCESS':
            res.error(nfs.NFS3ERR_ACCES)
            break

        case 'ENOENT':
            res.error(nfs.NFS3ERR_NOENT)
            break

        case 'ENOTDIR':
            res.error(nfs.NFS3ERR_NOTDIR)
            break

        case 'ENOTEMPTY':
            res.error(nfs.NFS3ERR_NOTEMPTY)
            break

        default:
            res.error(nfs.NFS3ERR_SERVERFAULT)
            break
    }
    next(false)
}

export function open(call, reply, next) {
    var log = call.log

    log.debug('open(%s): entered', call.object)

    if (call.fd_cache.has(call.object)) {
        call.stats = call.fd_cache.get(call.object)
        next()
        return
    }

    getDsFs().stat(call._filename, function(st_err, stats) {
        if (st_err) {
            log.warn(st_err, 'open: stat failed')
            reply.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }

        getDsFs().open(call._filename, 'r+', function(err, fd) {
            if (err) {
                log.warn(err, 'open: failed')
                reply.error(nfs.NFS3ERR_SERVERFAULT)
                next(false)
                return
            }

            call.stats = {
                fd: fd,
                size: stats.size
            }
            call.fd_cache.set(call.object, call.stats)

            log.debug('open(%s): done => %j', call.object, call.stats)
            next()
        })
    })
}

// based on http://stackoverflow.com/a/7616484
export function hash(s) {
    var h = 0,
        i,
        c

    var l = s.length
    if (l === 0) return h
    for (i = 0; i < l; i++) {
        c = s.charCodeAt(i)
        h = (h << 5) - h + c
        h |= 0 // Convert to 32bit integer
    }
    return Math.abs(h)
}
