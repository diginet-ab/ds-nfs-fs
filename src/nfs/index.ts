// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as assert from 'assert-plus'
import * as nfs from '@diginet/nfs'

import * as auth from '../auth'

import access from './access'
import create from './create'
import commit from './commit'
import fsinfo from './fsinfo'
import fsstat from './fsstat'
import getattr from './getattr'
import link from './link'
import lookup from './lookup'

import mkdir from './mkdir'
import mknod from './mknod'
import pathconf from './pathconf'
import read from './read'
import readdir from './readdir'
import readdirplus from './readdirplus'
import readlink from './readlink'
import remove from './remove'
import rename from './rename'
import rmdir from './rmdir'
import setattr from './setattr'
import symlink from './symlink'
import write from './write'
import { NFSConfig } from '../server'
import { FS } from '@diginet/ds-fs'
import Fhdb from '../fhdb'

export type Req = {
    fs: FS
    fhdb: Fhdb
} & {
    [key: string]: any
}

///--- API

export function createNfsServer(opts: NFSConfig) {
    assert.object(opts, 'options')
    assert.object(opts.fd_cache, 'options.fd_cache')
    assert.object(opts.fhdb, 'options.fhdb')
    assert.object(opts.log, 'options.log')
    assert.string(opts.vfspath, 'options.vfspath')
    assert.optionalObject(opts.hosts_allow, 'options.hosts_allow')
    assert.optionalObject(opts.hosts_deny, 'options.hosts_deny')

    // We have to check that each incoming NFS request is from an acceptable
    // host since each request is independent and there nothing that ties
    // the check we did in mountd to a request.
    function host_allowed(req, res) {
        assert.object(req.connection, 'req.connection')

        var ipaddr = req.connection.remoteAddress

        // hosts_deny entries are optional
        // if the address is present, disallow the mount
        if (req.hosts_deny && req.hosts_deny[ipaddr]) {
            req.log.warn('nfsd request from (%s) denied', ipaddr)
            res.error(nfs.MNT3ERR_ACCES)
            return false
        }

        // hosts_allow entries are optional
        // if hosts_allow exists, then the address must be preset or we disallow
        // the mount
        if (req.hosts_allow && !req.hosts_allow[ipaddr]) {
            req.log.warn('nfsd request from (%s) was not allowed', ipaddr)
            res.error(nfs.MNT3ERR_ACCES)
            return false
        }

        return true
    }

    var s = nfs.createNfsServer({
        log: opts.log
    })

    s.use(auth.authorize)
    s.use(function setup(req, res, next) {
        req.hosts_allow = opts.hosts_allow
        req.hosts_deny = opts.hosts_deny
        if (!host_allowed(req, res)) {
            next(false)
            return
        }

        req.fd_cache = opts.fd_cache
        req.fhdb = opts.fhdb
        req.vfspath = opts.vfspath // needed for fsstat
        req.fs = opts.fs
        next()
    })

    s.access(access())
    s.create(create())
    s.commit(commit())
    s.fsinfo(fsinfo())
    s.fsstat(fsstat())
    s.getattr(getattr())
    s.link(link())
    s.lookup(lookup())
    s.mkdir(mkdir())
    s.mknod(mknod())
    s.pathconf(pathconf())
    s.read(read())
    s.readdir(readdir())
    s.readdirplus(readdirplus())
    s.readlink(readlink())
    s.remove(remove())
    s.rename(rename())
    s.rmdir(rmdir())
    s.setattr(setattr())
    s.symlink(symlink())
    s.write(write())

    s.on('after', function(name, call, reply, err) {
        opts.log.debug(
            {
                procedure: name,
                rpc_call: call,
                rpc_reply: reply,
                err: err
            },
            'nfsd: %s handled',
            name
        )
    })

    return s
}
