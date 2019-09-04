// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as assert from 'assert-plus'
import * as nfs from '@diginet/nfs'
import * as common from './common'
import { Req } from '.';

function read(req: Req, reply, next) {
    var data = Buffer.alloc(req.count)
    var log = req.log
    var stats = req.stats

    log.debug('read(%s, %d, %d): entered', req.object, req.offset, req.count)

    assert.ok(stats)

    req.fs.read(stats.fd, data, 0, req.count, req.offset, function(err, n) {
        if (err) {
            log.warn(err, 'read: fsCache.read failed')
            reply.error(nfs.NFS3ERR_IO)
            next(false)
            return
        }

        // use stat.size to determine eof
        var eof = false
        if (stats.size <= req.offset + n) {
            eof = true

            // If we're at EOF, we assume we can close the FD out
            if (req.fd_cache.has(req.object)) req.fd_cache.del(req.object)
        }

        // some NFS clients verify that the returned buffer
        // length matches the result count
        if (n < req.count) data = data.slice(0, n)

        log.debug('read(%s): done => %d', req.object, n)

        reply.count = n
        reply.data = data
        reply.eof = eof
        reply.send()
        next()
    })
}

export default function chain() {
    return [common.fhandle_to_filename, common.open, read]
}
