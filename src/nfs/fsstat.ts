import { Req } from ".";

// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

///--- API

// Stolen from: http://goo.gl/fBLulQ (IBM)
function fsstat(req: Req, reply, next) {
    var log = req.log

    log.debug('fsstat(%s): entered', req.vfspath)

    let stats = {
        blocks: 1000,
        bsize: 512,
        bfree: 1000,
        bavail: 1000,
        files: 5,
        ffree: 5,
        favail: 5
    }

    reply.tbytes = stats.blocks * stats.bsize
    reply.fbytes = stats.bfree * stats.bsize
    reply.abytes = stats.bavail * stats.bsize
    reply.tfiles = stats.files
    reply.ffiles = stats.ffree
    reply.afiles = stats.favail
    reply.invarsec = 0

    log.debug('fsstat(%s): done', req.vfspath)
    reply.send()
    next()

    /*reply.error(nfs.NFS3ERR_NOTSUPP)
    next(false)*/


    /*statvfs(call.vfspath, function(err, stats) {
        if (err) {
            log.warn(err, 'fs_stat: statvfs failed')
            reply.error(nfs.NFS3ERR_IO)
            next(false)
        } else {
            reply.tbytes = stats.blocks * stats.bsize
            reply.fbytes = stats.bfree * stats.bsize
            reply.abytes = stats.bavail * stats.bsize
            reply.tfiles = stats.files
            reply.ffiles = stats.ffree
            reply.afiles = stats.favail
            reply.invarsec = 0

            log.debug('fsstat(%s): done', call.vfspath)
            reply.send()
            next()
        }
    })*/
}

export default function chain() {
    return [fsstat]
}
