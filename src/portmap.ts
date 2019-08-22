// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as assert from 'assert-plus'
import * as rpc from '@diginet/oncrpc'
import { createLogger } from 'bunyan'

///--- API

export function createPortmapClient(opts: { log: ReturnType<typeof createLogger>; url: string }) {
    assert.object(opts, 'options')
    assert.object(opts.log, 'options.log')
    assert.string(opts.url, 'options.url')

    var c = rpc.createPortmapClient({
        log: opts.log,
        url: opts.url
    })

    return c
}

export function createPortmapServer(opts: {
    log: any
    mappings: { [key: string]: { prog: number; vers: number; prot: number; port: number }[] }
}) {
    assert.object(opts, 'options')
    assert.object(opts.log, 'options.log')
    assert.object(opts.mappings, 'options.mappings')

    var mappings = {}
    var s = rpc.createPortmapServer({
        log: opts.log
    })

    Object.keys(opts.mappings).forEach(k => {
        mappings[k] = opts.mappings[k].map(i => {
            assert.number(i.prog, k + '.prog')
            assert.number(i.vers, k + '.vers')
            assert.number(i.prot, k + '.prot')
            assert.number(i.port, k + '.port')

            return {
                name: k,
                prog: i.prog,
                vers: i.vers,
                prot: i.prot,
                port: i.port
            }
        })
    })

    s.dump(function dump(req, res, next) {
        Object.keys(mappings).forEach(function(k) {
            mappings[k].forEach(function(i) {
                res.addMapping(i)
            })
        })

        res.send()
        next()
    })

    s.get_port(function get_port(req, res, next) {
        var m = req.mapping
        Object.keys(mappings).forEach(function(k) {
            mappings[k].some(function(i) {
                if (i.prog === m.prog && i.vers === m.vers && i.prot === m.prot) {
                    res.port = i.port
                    return true
                }

                return false
            })
        })

        res.send()
        next()
    })

    s.on('after', function(name, call, reply, err) {
        opts.log.debug(
            {
                procedure: name,
                rpc_call: call,
                rpc_reply: reply,
                err: err
            },
            'portmapd: %s handled',
            name
        )
    })

    return s
}
