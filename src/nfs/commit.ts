// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as assert from 'assert-plus'
import * as nfs from '@diginet/nfs'
import * as common from './common'
import { Req } from '.';

function commit(req: Req, reply, next) {
    var log = req.log
    var stats = req.stats

    log.debug('commit(%s): entered', req.object)

    assert.ok(stats)

    req.fs.fsync(stats.fd, function(err) {
        if (err) {
            log.warn(err, 'commit: fsync failed')
            reply.error(nfs.NFS3ERR_SERVERFAULT)
            next(false)
            return
        }

        reply.send()
        next()
    })
}

export default function chain() {
    return [common.fhandle_to_filename, common.open, commit]
}
