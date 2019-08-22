// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as assert from 'assert-plus'
import * as nfs from '@diginet/nfs'
import * as common from './common'

import { getDsFs } from '../fs'

///-- API

/**
 * Calls the function write, and then calls fsync to synchronize the written data.
 */
async function write(call, reply, next) {
    var c = call
    var log = call.log
    var stats = call.stats

    log.debug('write(%s, %d, %d): entered', c.object, c.offset, c.count)

    assert.ok(stats)

    getDsFs().write(stats.fd, c.data, 0, c.count, c.offset, async function(err, n, b) {
        if (err) {
            log.warn(err, 'write: failed')
            reply.error(nfs.NFS3ERR_SERVERFAULT)
            next(false)
            return
        }

        getDsFs().fsync(stats.fd, async err => {
            if (err) {
                log.warn(err, 'write: failed at fsync')
                reply.error(nfs.NFS3ERR_SERVERFAULT)
                next(false)
                return
            }

            reply.count = n
            reply.committed = nfs.stable_how.FILE_SYNC
            reply.send()

            if (c.offset + n > stats.size) stats.size = c.offset + n

            log.debug('write(%d): done', n)
            next()
        })
    })
}

export default function chain() {
    return [common.fhandle_to_filename, common.open, write]
}
