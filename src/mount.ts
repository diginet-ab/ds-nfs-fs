// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as fs from 'fs'
import * as path from 'path'

import * as assert from 'assert-plus'
import * as nfs from '@diginet/nfs'

import * as auth from './auth'
import { MountConfig } from './server'

///--- Globals

const MNTPATHLEN = 1024 // This is defined by the RFC

///--- API

function ensure_allowed(req, res, next) {
    assert.object(req.connection, 'req.connection')

    var ipaddr = req.connection.remoteAddress

    // hosts_deny entries are optional
    // if the address is present, disallow the mount
    if (req.hosts_deny && req.hosts_deny[ipaddr]) {
        req.log.warn('mountd request from (%s) denied', ipaddr)
        res.error(nfs.MNT3ERR_ACCES)
        next(false)
        return
    }

    // hosts_allow entries are optional
    // if hosts_allow exists, then the address must be preset or we disallow
    // the mount
    if (req.hosts_allow && !req.hosts_allow[ipaddr]) {
        req.log.warn('mountd request from (%s) was not allowed', ipaddr)
        res.error(nfs.MNT3ERR_ACCES)
        next(false)
        return
    }

    next()
}

function ensure_allowMount(req, res, next) {
    assert.string(req.dirpath, 'req.dirpath')

    var p = path.normalize(req.dirpath)

    if (p.length > MNTPATHLEN) {
        res.error(nfs.MNT3ERR_NAMETOOLONG)
        next(false)
        return
    }

    // export entries are optional
    if (req.allowMount) {
        // since we have exports, we must check each one since the client may
        // be trying to mount a subdir of an export
        if (!req.allowMount(p)) {
            res.error(nfs.MNT3ERR_ACCES)
            next(false)
            return
        }
    }

    req._dirpath = p
    next()
}

function mount(call, reply, next) {
    var log = call.log

    log.debug('mount(%s): entered', call._dirpath)
    fs.stat(call._dirpath, async function(serr, dummystats) {
        if (serr) {
            log.warn(serr, 'mount(%s): failed to stat', call._dirpath)
            reply.error(nfs.MNT3ERR_SERVERFAULT)
            next(false)
            return
        }

        try {
            var fhandle = await call.fhdb.lookup(call._dirpath)
        } catch (lerr) {
            log.warn(lerr, 'mount(%s): failed to lookup', call._dirpath)
            reply.error(lerr.nfsErrorCode) // Was nfs.MNT3ERR_SERVERFAULT
            next(false)
            return
        }

        var ipaddr = call.connection.remoteAddress

        reply.setFileHandle(fhandle)
        log.info('mount(%s) from (%s): done -> %s', call._dirpath, ipaddr, fhandle)
        reply.send()
        next()
    })
}

function umount(call, reply, next) {
    var log = call.log

    // We don't invoke call.fs.shutdown here since the server is still running
    // and they may want to mount again later.

    var ipaddr = call.connection.remoteAddress
    log.info('umount(%s) from (%s) done', call._dirpath, ipaddr)
    reply.send()
    next()
}

export function createMountServer(opts: MountConfig) {
    assert.object(opts, 'options')

    assert.optionalObject(opts.hosts_allow, 'options.hosts_allow')
    assert.optionalObject(opts.hosts_deny, 'options.hosts_deny')
    assert.object(opts.log, 'options.log')
    assert.object(opts.fhdb, 'options.fhdb')

    var s = nfs.createMountServer({
        log: opts.log
    })

    s.use(auth.authorize)
    s.use(function setup(req, res, next) {
        req.allowMount = opts.allowMount
        req.hosts_allow = opts.hosts_allow
        req.hosts_deny = opts.hosts_deny
        req.fhdb = opts.fhdb
        next()
    })
    s.mnt(ensure_allowed, ensure_allowMount, mount)

    s.umnt(ensure_allowed, ensure_allowMount, umount)

    s.on('after', function(name, call, reply, err) {
        opts.log.debug(
            {
                procedure: name,
                rpc_call: call,
                rpc_reply: reply,
                err: err
            },
            'mountd: %s handled',
            name
        )
    })

    return s
}
