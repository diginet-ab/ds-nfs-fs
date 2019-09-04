// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as path from 'path'
import * as nfs from '@diginet/nfs'
import { Req } from '.';

async function mkdir_lookup_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('mkdir_lookup_dir(%s): entered', req.where.dir)

    try {
        var name = await req.fhdb.fhandle(req.where.dir)
    } catch (err) {
        log.warn(err, 'mkdir_lookup_dir(%s): fhandle notfound', req.where.dir)
        reply.error(err.nfsErrorCode)
        next(false)
        return
    }

    req._dirname = name
    req._filename = path.join(name, req.where.name)
    log.debug('mkdir_lookup_dir(%s): done -> %s', req.where.dir, name)
    next()
}

function mkdir_stat_dir(req: Req, reply, next) {
    var log = req.log

    log.debug('mkdir_stat_dir(%s): entered', req._dirname)
    req.fs.stat(req._dirname, function(err, stats) {
        if (err) {
            log.warn(err, 'mkdir_stat_dir(%s): failed', req._dirname)
            reply.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }
        if (!stats.isDirectory()) {
            log.warn(err, 'mkdir_stat_dir(%s): not a directory', req._dirname)
            reply.error(nfs.NFS3ERR_NOTDIR)
            next(false)
            return
        }

        log.debug('mkdir_stat_dir(%s): done', req._dirname)
        next()
    })
}

function mkdir(req: Req, reply, next) {
    var log = req.log
    var mode

    if (req.attributes.mode !== null) mode = req.attributes.mode
    else mode = parseInt('0755')

    log.debug('mkdir(%s, %d): entered', req._filename, mode)
    req.fs.mkdir(req._filename, mode, function(err) {
        if (err) {
            log.warn(err, 'mkdir(%s): failed', req._filename)
            reply.error(nfs.NFS3ERR_NOTDIR)
            next(false)
            return
        }

        // Set the owner
        // Not supported in BrowserFs
        /*fs.fs.chown(call._filename, call.auth.uid, call.auth.gid, function(cerr) {
            if (cerr) call.log.warn(cerr, 'mkdir: chown failed')*/
        log.debug('mkdir(%s): done', req._filename)
        next()
        //})
    })
}

async function mkdir_lookup(call, reply, next) {
    var log = call.log

    log.debug('mkdir_lookup(%s): entered', call._filename)

    try {
        var fhandle = await call.fhdb.lookup(call._filename)
    } catch (err) {
        log.warn(err, 'mkdir_lookup(%s): failed', call._filename)
        reply.error(err.nfsErrorCode) // Was nfs.NFS3ERR_NOENT
        next(false)
        return
    }

    log.debug('mkdir_lookup(%s): done', fhandle)
    reply.obj = fhandle
    next()
}

function mkdir_stat_newdir(req: Req, reply, next) {
    var log = req.log

    log.debug('mkdir_stat_newdir(%s): entered', req._filename)
    req.fs.stat(req._filename, function(err, stats) {
        if (err) {
            log.warn(err, 'mkdir_stat_newdir(%s): failed', req._filename)
            reply.error(nfs.NFS3ERR_NOENT)
            next(false)
            return
        }

        reply.setObjAttributes(stats)
        log.debug({ stats: stats }, 'mkdir_stat_newdir(%s): done', req._filename)
        reply.send()
        next()
    })
}

export default function chain() {
    return [mkdir_lookup_dir, mkdir_stat_dir, mkdir, mkdir_lookup, mkdir_stat_newdir]
}
