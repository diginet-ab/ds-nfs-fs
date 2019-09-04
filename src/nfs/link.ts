// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'
import * as path from 'path'
import { Req } from '.';

///-- API

async function link_lookup_file(req: Req, res, next) {
    var log = req.log

    log.debug('link_lookup_file(%s): entered', req.file)

    try {
        var name = await req.fhdb.fhandle(req.file)
    } catch (err) {
        log.warn(err, 'link_lookup_file(%s): fhandle notfound', req.file)
        res.error(err.nfsErrorCode)
        next(false)
        return
    }

    req._filename = name
    log.debug('link_lookup_file(%s): done->%s', req.file, name)
    next()
}

async function link_lookup_dir(req: Req, res, next) {
    var log = req.log

    log.debug('link_lookup_dir(%s): entered', req.link.dir)

    try {
        var name = await req.fhdb.fhandle(req.link.dir)
    } catch (err) {
        log.warn(err, 'link_lookup_dir(%s): fhandle notfound', req.link.dir)
        res.error(err.nfsErrorCode)
        next(false)
        return
    }

    req._dirname = name
    req._destname = path.join(name, req.link.name)
    log.debug('link_lookup_dir(%s): done->%s', req.link.dir, name)
    next()
}

function link(req: Req, res, next) {
    var log = req.log

    log.debug('link(%s->%s): entered', req._destname, req._filename)
    req.fs.link(req._filename, req._destname, function(err) {
        if (err) {
            log.warn(err, 'link(%s): failed', req._destname)
            // XXX better error return codes
            res.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }

        log.debug('link(%s): done', req._destname)
        next()
    })
}

function link_stat(req: Req, res, next) {
    var log = req.log

    log.debug('link_stat(%s): entered', req._destname)
    req.fs.lstat(req._destname, function(err, stats) {
        if (err) {
            log.warn(err, 'link_stat(%s): failed', req._destname)
            res.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }

        res.setFileAttributes(stats)
        log.debug('link_stat(%s): done', req._destname)
        res.send()
        next()
    })
}

///--- Exports

export default function chain() {
    return [link_lookup_file, link_lookup_dir, link, link_stat]
}
