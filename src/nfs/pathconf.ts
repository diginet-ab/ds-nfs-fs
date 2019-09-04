// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'
import * as common from './common'
import { Req } from '.';

// Stolen from: http://goo.gl/fBLulQ (IBM)
function pathconf(req: Req, reply, next) {
    var log = req.log

    log.debug('pathconf(%s): entered', req.object)

    req.fs.stat(req._filename, function(err, stats) {
        if (err) {
            log.debug(err, 'pathconf(%s): stat failed', req._filename)
            reply.error(nfs.NFS3ERR_STALE)
            reply.send()
            next(false)
        } else {
            reply.setAttributes(stats)

            reply.linkmax = 0
            reply.name_max = 1024
            reply.no_trunc = true
            reply.chown_restricted = true
            reply.case_insensitive = false
            reply.case_preserving = true

            log.debug('pathconf(%s): done', req.object)
            reply.send()
            next()
        }
    })
}

export default function chain() {
    return [common.fhandle_to_filename, pathconf]
}
