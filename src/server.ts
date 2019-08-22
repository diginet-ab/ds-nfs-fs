// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as util from 'util'
import * as assert from 'assert-plus'

import * as userid from 'userid'
import * as LRU from 'lru-cache'

import { createLogger } from 'bunyan'

import * as portmap from './portmap'
import Fhdb from './fhdb'

import * as _bunyan from 'bunyan'
import * as bunyan from './bunyan'
import { createMountServer } from './mount'
import { createNfsServer } from './nfs'

import { FS } from '@diginet/ds-fs'
import { setDsFs } from './fs'

///--- Functions

function configure() {
    let LOG = bunyan.createLogger().child({
        level: 'debug', // 'trace' for verbose, 'debug' for debug, 'info' for normal
        src: true
    })

    let t_uid: number
    let t_gid: number

    try {
        t_uid = convert_neg_id(userid.uid('nobody'))
    } catch (e1) {
        t_uid = 65534
    }

    try {
        t_gid = convert_neg_id(userid.gid('nobody'))
    } catch (e1) {
        // Linux uses 'nogroup' instead of 'nobody'
        try {
            t_gid = convert_neg_id(userid.gid('nogroup'))
        } catch (e2) {
            t_gid = t_uid
        }
    }

    var cfg = {
        log: LOG,
        database: {
            location: '/sdcdata'
        },
        portmap: {
            url: '',
            log: LOG,
            port: 111,
            mappings: {
                mountd: [
                    {
                        prog: 100005,
                        vers: 3,
                        prot: 6,
                        port: 1892
                    },
                    {
                        prog: 100005,
                        vers: 1,
                        prot: 6,
                        port: 1892
                    }
                ],
                nfsd: [
                    {
                        prog: 100003,
                        vers: 3,
                        prot: 6,
                        port: 2049
                    }
                ],
                portmapd: [
                    {
                        prog: 100000,
                        vers: 2,
                        prot: 6,
                        port: 111
                    }
                ]
            }
        },
        mount: { log: LOG },
        nfs: {
            log: LOG,
            uid: t_uid,
            gid: t_gid,
            fd_cache: {
                max: 10000,
                ttl: 60
            }
        }
    } as {
        log: any
        database: {
            location: string
        }
        portmap: {
            usehost?: boolean | number
            log: any
            port: number
            mappings: {
                [key: string]: {
                    prog: number
                    vers: number
                    prot: number
                    port: number
                }[]
            }
            url: string
            address?: string
        }
        mount: {
            log: any
            fhdb?: Fhdb
            exports?: any
        }
        nfs: {
            log: any
            uid: number
            gid: number
            fd_cache: {
                max?: number
                ttl?: number
            }
            fhdb?: Fhdb
            vfspath?: string
        }
    }

    return cfg
}

/**
 * Runs the mountd and nfsd servers. Called once we're registered with the
 * system's portmapper or once we've started our own portmapper.
 */
function run_servers(log: ReturnType<typeof createLogger>, cfg_mount, cfg_nfs) {
    var mountd = createMountServer(cfg_mount)
    var nfsd = createNfsServer(cfg_nfs)

    mountd.on('error', function(e) {
        if (e.code == 'EADDRINUSE') {
            log.fatal('mountd already running, exiting.')
        } else {
            log.fatal(e, 'unable to run the mountd')
        }
        process.exit(1)
    })

    nfsd.on('error', function(e) {
        if (e.code == 'EADDRINUSE') {
            log.fatal('nfsd already running, exiting.')
        } else {
            log.fatal(e, 'unable to run the nfsd')
        }
        process.exit(1)
    })

    mountd.listen(cfg_mount.port || 1892, cfg_mount.address || '0.0.0.0', function() {
        console.log('mount server listening on address: ', mountd.address())
    })

    // nfsd needs to listen on the same IP as configured for the mountd
    nfsd.listen(cfg_nfs.port || 2049, cfg_mount.address || '0.0.0.0', function() {
        console.log('nfs server listening on address: ', nfsd.address())
    })
}

// Darwin uses negative numbers for 'nobody' but these get pulled out as a
// large non-negative number. Convert to twos-complement.
function convert_neg_id(id) {
    if (id > 0x7fffffff) return -(~id + 1)
    else return id
}

function createFHDB(opts) {
    assert.optionalObject(opts, 'options')

    var log =
        opts.log ||
        _bunyan.createLogger({
            stream: process.stderr,
            level: (process.env.LOG_LEVEL as any) || 'warn',
            name: 'fhdb',
            serializers: _bunyan.stdSerializers
        })

    return new Fhdb({
        location: opts.path || '/var/tmp/sdcnfs',
        log: log
    })
}

///--- Mainline

/**
 * Launches the NFS server.
 */
export function main(dsFs: FS) {
    setDsFs(dsFs)

    var cfg = configure()
    var log = cfg.log

    var fhdb = createFHDB({
        log: log.child({ component: 'fhDB' }, true),
        location: cfg.database.location
    })

    // must always use the system's portmapper on sunos
    if (os.platform() === 'sunos') cfg.portmap.usehost = true

    cfg.mount.fhdb = fhdb
    cfg.nfs.fhdb = fhdb
    cfg.nfs.fd_cache = new LRU({
        dispose: (key, n: any) => {
            fs.close(n.fd, function on_close(err) {
                if (err) log.debug(err, 'failed to close(fd=%d) for %s', n.fd, key)
            })
        },
        max: cfg.nfs.fd_cache.max,
        maxAge: cfg.nfs.fd_cache.ttl * 1000 // 1m TTL
    })

    // vfspath used by fsstat
    if (cfg.mount.exports) {
        for (var i in cfg.mount.exports) break
        cfg.nfs.vfspath = i
    } else {
        cfg.nfs.vfspath = process.cwd()
    }

    log.info('configuration: %s', util.inspect(cfg))

    var mntmapping = {
        prog: 100005,
        vers: 3,
        prot: 6,
        port: 1892
    }

    var nfsmapping = {
        prog: 100003,
        vers: 3,
        prot: 6,
        port: 2049
    }

    function cleanup() {
        fhdb.close(function(err) {
            if (err) {
                log.warn(err, 'file handle database shutdown error')
            }

            if (cfg.portmap.usehost) {
                var pmapclient = portmap.createPortmapClient(cfg.portmap)

                pmapclient.once('connect', function() {
                    pmapclient.unset(mntmapping, function(err1) {
                        if (err1) {
                            log.warn(err1, 'unregistering mountd from the portmapper')
                        }

                        pmapclient.unset(nfsmapping, function(err2) {
                            if (err2) {
                                log.warn(err2, 'unregistering nfsd from the portmapper')
                            }
                            log.info('Shutdown complete, exiting.')
                            process.exit(0)
                        })
                    })
                })
            } else {
                log.info('Shutdown complete, exiting.')
                process.exit(0)
            }
        })
    }

    process.on('SIGTERM', function() {
        log.info('Got SIGTERM, shutting down.')
        cleanup()
    })

    process.on('SIGINT', function() {
        log.info('Got SIGINT, shutting down.')
        cleanup()
    })

    fhdb.once('error', function(err) {
        log.fatal(err, 'unable to initialize file handle database')
        process.exit(1)
    })
    fhdb.once('ready', function() {
        // file handle DB exists now, ensure modes are more secure
        fs.chmodSync(fhdb.location, parseInt('0700', 8))
        fs.chmodSync(path.join(fhdb.location, 'fh.db'), parseInt('0600', 8))

        // The portmapper needs to listen on all addresses, unlike our mountd
        // and nfsd which only listen on localhost by default.
        // XXX bad default
        cfg.portmap.address = cfg.portmap.address || '0.0.0.0'
        cfg.portmap.port = cfg.portmap.port || 111

        // Use the system's portmapper
        function register_with_pmap() {
            // The Linux portmapper normally rejects requests that are not
            // made to the loopback address.
            cfg.portmap.url = util.format('udp://127.0.0.1:%d', cfg.portmap.port)
            var pmapclient = portmap.createPortmapClient(cfg.portmap)

            pmapclient.on('error', function(e) {
                log.fatal(e, 'unable to connect to the system`s portmapper')
                process.exit(1)
            })

            pmapclient.once('connect', function() {
                pmapclient.set(mntmapping, function(err1) {
                    if (err1) {
                        log.fatal(err1, 'unable to register mountd with the portmapper')
                        process.exit(1)
                    }

                    pmapclient.set(nfsmapping, function(err2) {
                        if (err2) {
                            log.fatal(err2, 'unable to register nfsd with the portmapper')
                            process.exit(1)
                        }

                        pmapclient.close()
                        run_servers(cfg.log, cfg.mount, cfg.nfs)
                    })
                })
            })
        }

        if (cfg.portmap.usehost) {
            register_with_pmap()
        } else {
            // Here we run our own portmapper
            var pmapd = portmap.createPortmapServer(cfg.portmap)

            pmapd.on('error', function(e) {
                if (e.code == 'EADDRINUSE') {
                    log.info('Portmapper running, registering there...')
                    cfg.portmap.usehost = 1
                    register_with_pmap()
                } else {
                    log.fatal(e, 'unable to run the portmapper')
                    process.exit(1)
                }
            })

            pmapd.listen(cfg.portmap.port, cfg.portmap.address, function() {
                run_servers(cfg.log, cfg.mount, cfg.nfs)
            })
        }
    })
}
