// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as path from 'path'
import * as nfs from '@diginet/nfs'
import * as common from './common'
import * as rpc from '@diginet/oncrpc'
import { Req } from '.';

function readdir(req: Req, reply, next) {
    var log = req.log
    log.debug('readdir(%s): entered', req._filename)

    // XXX TBD handle . and ..
    req.fs.readdir(req._filename, function(err, files) {
        if (err) {
            log.warn(err, 'readdir(%s): failed', req.dir)
            reply.error(err.code === 'ENOTDIR' ? nfs.NFS3ERR_NOTDIR : nfs.NFS3ERR_IO)
            next(false)
            return
        }

        // The cookieverf will be 0 on the initial call.
        var h = common.hash(req._filename)
        if (req.cookieverf.readUInt32LE(0) != 0) {
            // This is a follow-up call, confirm cookie.
            if (req.cookieverf.readUInt32LE(0) != h) {
                reply.error(nfs.NFS3ERR_BAD_COOKIE)
                next(false)
                return
            }
        }

        reply.eof = true

        var cook = 1
        // Track the returned data size
        // status (4) + bool_dir_attrs (4) + fattr3.XDR_SIZE +
        // cookieverf3 (8) + bool_eof (4) + final_list_false (4)
        // See nfs readdir_reply.js.
        var sz = 116
        files.every(function(f) {
            // The call cookie will be 0 on the initial call
            if (req.cookie != 0 && req.cookie >= cook) {
                // we need to scan the dir until we reach the right entry
                cook++
                return true
            }

            // We need to track the returned data size to be sure we fit in
            // call.count bytes.
            // list_true (4) + fileid (8) + cookie (8) + name_len
            var delta = 20 + rpc.XDR.byteLength(f)
            if (sz + delta > req.count) {
                reply.eof = false
                return false
            }

            reply.addEntry({
                fileid: common.hash(path.join(req._filename, f)),
                name: f,
                cookie: cook++
            })
            sz += delta
            return true
        })

        reply.cookieverf = Buffer.alloc(8)
        reply.cookieverf.fill(0)
        reply.cookieverf.writeUInt32LE(h, 0, true)

        req.fs.stat(req._filename, function(err2, stats) {
            if (err2) {
                log.warn(err2, 'readdir(%s): stat failed', req._filename)
            } else {
                reply.setDirAttributes(stats)
            }
            reply.send()
            next()
        })
    })
}

export default function chain() {
    return [common.fhandle_to_filename, readdir]
}
