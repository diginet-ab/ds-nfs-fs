// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'
import * as path from 'path'
import { Req } from '.';

async function lookup_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('lookup_dir(%s): entered', req.what.dir)

    try {
        var name = await req.fhdb.fhandle(req.what.dir)
    } catch (err) {
        log.debug(err, 'lookup_dir(%s): fhandle notfound', req.what.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    req._dirname = name
    req._filename = path.join(name, req.what.name)
    log.debug('lookup_dir(%s): done -> %s', req.what.dir, name)
    next()
}

function stat_file(req: Req, reply, next) {
    var log = req.log

    log.debug('stat_file(%s): entered', req._filename)
    req.fs.lstat(req._filename, function(err, stats) {
        if (err) {
            log.debug(err, 'stat_file(%s): failed', req._filename)
            reply.error(nfs.NFS3ERR_NOENT)
            next(false)
        } else {
            // reply.object = uuid;
            reply.setAttributes(stats)
            log.debug({ stats: stats }, 'stat_file(%s): done', req._filename)
            next()
        }
    })
}

function stat_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('stat_dir(%s): entered', req._dirname)
    req.fs.stat(req._dirname, function(err, stats) {
        if (err) {
            log.debug(err, 'stat_dir(%s): failed', req._dirname)
            reply.error(nfs.NFS3ERR_IO)
            next(false)
        } else {
            reply.setDirAttributes(stats)
            log.debug({ stats: stats }, 'stat_dir(%s): done', req._dirname)
            next()
        }
    })
}

async function lookup(req: Req, reply, next) {
    var log = req.log

    log.debug('lookup(%s): entered', req._filename)

    try {
        var fhandle = await req.fhdb.lookup(req._filename)
    } catch (err) {
        log.debug(err, 'lookup(%s): failed', req._filename)
        reply.error(err.nfsErrorCode) // Was nfs.NFS3ERR_NOENT
        next(false)
        return
    }

    reply.object = fhandle
    reply.send()
    next()
}

export default function chain() {
    return [
        function cheat(call, reply, next) {
            call._object_override = call.what.dir
            next()
        },
        lookup_dir,
        stat_dir,
        stat_file,
        lookup
    ]
}
