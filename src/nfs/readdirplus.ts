// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as path from 'path'
import * as nfs from '@diginet/nfs'
import * as vasync from 'vasync'
import * as common from './common'
import * as rpc from '@diginet/oncrpc'
import { Req } from '.';
var XDR = rpc.XDR

function readdirplus(req: Req, reply, next) {
    var log = req.log
    log.debug('readdirplus(%s): entered', req._filename)

    var error = null
    var cook = 1

    // Track the returned data size
    // status (4) + bool_dir_attrs (4) + fattr3.XDR_SIZE +
    // cookieverf3 (8) + bool_eof (4) + final_list_false (4)
    // See nfs readdirplus_reply.js.
    var totsz = 116

    // total dir entries size, not including attributes and file handle portion
    var sz = 0

    function process_entry(fname, nextent) {
        // The call cookie will be 0 on the initial call
        if (req.cookie != 0 && req.cookie >= cook) {
            // we need to scan the dir until we reach the right entry
            cook++
            nextent()
            return
        }

        if (reply.eof === false || error) {
            // We hit our return limit on a previous entry, skip the rest
            nextent()
            return
        }

        // We need to track the basic returned data size to be sure we fit in
        // call.dircount bytes.
        // list_true (4) + fileid (8) + cookie (8) + name_len
        var delta = 20 + XDR.byteLength(fname)
        if (sz + delta > req.dircount) {
            reply.eof = false
            nextent()
            return
        }
        sz += delta

        // We also need to track the total returned data size to be sure we
        // fit in call.maxcount bytes.
        // list_true (4) + fileid (8) + cookie (8) + name_len +
        // bool_name_attr (4) + name_attr_len +
        // bool_name_handle (4) + name_handle_len
        delta = 28 + XDR.byteLength(fname) + 84 + 64
        if (totsz + delta > req.maxcount) {
            reply.eof = false
            nextent()
            return
        }
        totsz += delta

        // path.join will properly handle resolving . and .. into the correct
        // name for the fhdb.lookup.
        var p = path.join(req._filename, fname)
        req.fs.lstat(p, async function(err2, stats) {
            if (err2) {
                log.warn(err2, 'readdirplus(%s): stat failed', p)
                error = error || nfs.NFS3ERR_IO
                nextent()
            } else {
                try {
                    var fhandle = await req.fhdb.lookup(req._filename)
                } catch (err3) {
                    log.warn(err3, 'readdirplus(%s): lu failed', p)
                    error = error || err3.nfsErrorCode // was nfs.NFS#ERR_IO
                    nextent()
                    return
                }

                reply.addEntry({
                    fileid: common.hash(p),
                    name: fname,
                    cookie: cook++,
                    name_attributes: nfs.create_fattr3(stats),
                    name_handle: fhandle
                })
                nextent()
            }
        })
    }

    function all_done() {
        if (error) {
            reply.error(error)
            next(false)
        } else {
            req.fs.stat(req._filename, function(err, stats) {
                if (err) {
                    log.warn(err, 'readdirplus(%s): dir stat failed', req._filename)
                } else {
                    reply.setDirAttributes(stats)
                }
                log.debug('readdirplus(%s): done', req._filename)
                reply.send()
                next()
            })
        }
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

    reply.cookieverf = Buffer.alloc(8)
    reply.cookieverf.fill(0)
    reply.cookieverf.writeUInt32LE(h, 0, true)

    // fs.readdir omits . and .. so we manually prepend them
    process_entry('.', function(erra) {
        process_entry('..', function(errb) {
            req.fs.readdir(req._filename, function(err1, files) {
                if (err1) {
                    log.warn(err1, 'readdirplus(%s): rd failed', req._filename)
                    error = err1.code === 'ENOTDIR' ? nfs.NFS3ERR_NOTDIR : nfs.NFS3ERR_IO
                    reply.error(error)
                    next(false)
                    return
                }

                vasync.forEachPipeline(
                    {
                        func: process_entry,
                        inputs: files
                    },
                    all_done
                )
            })
        })
    })
}

export default function chain() {
    return [common.fhandle_to_filename, readdirplus]
}
