// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as path from 'path'
import * as nfs from '@diginet/nfs'
import { Req } from '.';

async function create_lookup_dir(call, reply, next) {
    var log = call.log

    log.debug('create_lookup_dir(%s): entered', call.where.dir)

    try {
        var name = await call.fhdb.fhandle(call.where.dir)
    } catch (err) {
        log.warn(err, 'create_lookup_dir(%s): fhandle notfound', call.where.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    call._dirname = name
    call._filename = path.join(name, call.where.name)
    log.debug('create_lookup_dir(%s): done -> %s', call.where.dir, name)
    next()
}

async function do_create(flags, req: Req, reply, next) {
    var mode = req.obj_attributes.mode

    // mode is null when call.how === nfs.create_how.EXCLUSIVE
    if (mode === null) mode = parseInt('0644', 8)

    // We don't use the fd cache here since that only works with existing files
    // and always opens with the 'r+' flag. We need to create the file here
    // with either the 'w' or 'wx' flags.
    req.fs.open(req._filename, flags, mode, async function(open_err, fd) {
        if (open_err) {
            req.log.warn(open_err, 'create: open failed')
            reply.error(nfs.NFS3ERR_SERVERFAULT)
            next(false)
            return
        }

        // Passing the mode on fs.open doesn't set the correct mode. This could
        // be a node.js bug for a specific release. Explicitly set the mode as
        // a workaround.
        /*Not supported in BrowserFs
        fs.fs.fchmod(fd, mode, function(err) {
            // we're ignoring errors on chmod/chown/close
            if (err) call.log.warn(err, 'create: chmod failed')

            // Set the owner
            fs.fs.fchown(fd, call.auth.uid, call.auth.gid, function(c_err) {
                if (c_err) call.log.warn(c_err, 'create: chown failed')
                fs.fs.close(fd, function(close_err) {
                    next()
                })
            })
        })*/

        req.fs.close(fd, function(close_err) {
            next()
        })
    })
}

function create(req: Req, reply, next) {
    var log = req.log

    log.debug('create(%s, %d): entered', req.object, req.how)

    if (req.how === nfs.create_how.EXCLUSIVE) {
        req.fs.stat(req._filename, function(err, stats) {
            if (err && err.code === 'ENOENT') {
                // This is the "normal" code path (i.e. non-error)
                do_create('wx', req, reply, next)
            } else {
                log.debug('create (exclusive) file exists')
                reply.error(nfs.NFS3ERR_EXIST)
                next(false)
            }
        })
    } else if (req.how === nfs.create_how.UNCHECKED) {
        do_create('w', req, reply, next)
    } else {
        // call.how === nfs.create_how.GUARDED
        req.fs.stat(req._filename, function(err, stats) {
            if (err && err.code === 'ENOENT') {
                // This is the "normal" code path (i.e. non-error)
                do_create('w', req, reply, next)
            } else {
                log.debug('create (guarded) file exists')
                reply.error(nfs.NFS3ERR_EXIST)
                next(false)
            }
        })
    }
}

async function create_lookup(req: Req, reply, next) {
    var log = req.log

    log.debug('create_lookup(%s): entered', req._filename)

    try {
        var fhandle = await req.fhdb.lookup(req._filename)
    } catch (err) {
        log.warn(err, 'create_lookup(%s): failed', req._filename)
        reply.error(err.nfsErrorCode) // Was nfs.NFS3ERR_STALE
        next(false)
        return
    }

    log.debug('create_lookup(%s): done', fhandle)
    reply.obj = fhandle

    next()
}

function create_stat(req: Req, reply, next) {
    var log = req.log

    log.debug('create_stat(%s): entered', req._filename)
    req.fs.stat(req._filename, function(err, stats) {
        if (err) {
            log.warn(err, 'create_stat(%s): failed', req._filename)
            reply.error(nfs.NFS3ERR_STALE)
            next(false)
            return
        }

        reply.setObjAttributes(stats)
        log.debug({ stats: stats }, 'create_stat(%s): done', req._filename)
        reply.send()
        next()
    })
}

export default function chain() {
    return [create_lookup_dir, create, create_lookup, create_stat]
}
