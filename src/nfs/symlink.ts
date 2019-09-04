// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'
import * as path from 'path'
import { Req } from '.';

async function symlink_lookup_dir(req: Req, res, next) {
    var log = req.log

    log.debug('symlink_lookup_dir(%s): entered', req.where.dir)

    try {
        var name = await req.fhdb.fhandle(req.where.dir)
    } catch (err) {
        log.warn(err, 'symlink_lookup_dir(%s): fhandle notfound', req.where.dir)
        res.error(err.nfsErrorCode)
        next(false)
        return
    }

    req._dirname = name
    req._filename = path.join(name, req.where.name)
    log.debug('symlink_lookup_dir(%s): done->%s', req.where.dir, name)
    next()
}

function symlink(req: Req, res, next) {
    var log = req.log

    log.debug('symlink(%s->%j): entered', req._filename, req.symlink_data)
    req.fs.symlink(req.symlink_data, req._filename, function(err) {
        if (err) {
            log.warn(err, 'symlink(%s): failed', req._filename)
            // XXX better error return codes
            res.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }

        log.debug('symlink(%s): done', req._filename)
        next()
    })
}

async function symlink_lookup(req: Req, res, next) {
    var log = req.log

    log.debug('symlink_lookup(%s): entered', req._filename)

    try {
        var fhandle = await req.fhdb.lookup(req._filename)
    } catch (err) {
        log.warn(err, 'symlink_lookup(%s): failed', req._filename)
        res.error(err.nfsErrorCode) // Was nfs.NFS3ERR_IO
        next(false)
        return
    }

    log.debug('symlink_lookup(%s): done', fhandle)
    res.obj = fhandle
    next()
}

function symlink_stat(req: Req, res, next) {
    var log = req.log

    log.debug('symlink_stat(%s): entered', req._filename)
    req.fs.lstat(req._filename, function(err, stats) {
        if (err) {
            log.warn(err, 'symlink_stat(%s): failed', req._filename)
            res.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }

        res.setObjAttributes(stats)
        log.debug('symlink_stat(%s): done', req._filename)
        res.send()
        next()
    })
}

export default function chain() {
    return [symlink_lookup_dir, symlink, symlink_lookup, symlink_stat]
}
