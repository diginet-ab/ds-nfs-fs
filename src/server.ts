// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as fs from 'fs'
import * as util from 'util'

import * as LRU from 'lru-cache'

import { createLogger } from 'bunyan'

import * as portmap from './portmap'
import { Fhdb, DB } from './fhdb'

import * as _bunyan from 'bunyan'
import * as bunyan from './bunyan'
import { createMountServer } from './mount'
import { createNfsServer } from './nfs'

import { FS } from '@diginet/ds-fs'

type PMapConfig = {
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
    address: string
}

export type MountConfig = {
    log: any
    fhdb: Fhdb
    hosts_allow?: string[]
    hosts_deny?: string[]
    allowMount?: (path: string) => boolean
}

export type NFSConfig = {
    log: any
    fd_cache: {
        max?: number
        ttl?: number
    }
    fhdb: Fhdb
    vfspath: string
    fs: FS
    hosts_allow?: string[]
    hosts_deny?: string[]
}

type Config = {
    log: any
    mount: MountConfig
    nfs: NFSConfig
}

const LOG = bunyan.createLogger().child({
    level: 100, // 'trace' for verbose, 'debug' for debug, 'info' for normal, 100 for none.
    src: true
})

function configurePortmap(nfsPort: number, mountPort: number, pmapPort: number): PMapConfig {
    return {
        url: '',
        log: LOG,
        address: '0.0.0.0',
        port: pmapPort,
        mappings: {
            mountd: [
                {
                    prog: 100005,
                    vers: 3,
                    prot: 6,
                    port: mountPort
                },
                {
                    prog: 100005,
                    vers: 1,
                    prot: 6,
                    port: mountPort
                }
            ],
            nfsd: [
                {
                    prog: 100003,
                    vers: 3,
                    prot: 6,
                    port: nfsPort
                }
            ],
            portmapd: [
                {
                    prog: 100000,
                    vers: 2,
                    prot: 6,
                    port: pmapPort
                }
            ]
        }
    }
}

/**
 * Create some default configurations, create a logger instance, launch the FHDB for storing file handles.
 */
function configure(options: {
    fs: FS
    db: DB
    nfsHostsAllow?: string[]
    nfsHostsDeny?: string[]
    mountHostsAllow?: string[]
    mountHostsDeny?: string[]
    allowMount?: (path: string) => boolean
}) {
    const fhdb = new Fhdb({
        fs: options.fs,
        db: options.db
    })

    const cfg: Config = {
        log: LOG,
        mount: {
            allowMount: options.allowMount,
            hosts_allow: options.mountHostsAllow,
            hosts_deny: options.mountHostsDeny,
            log: LOG,
            fhdb
        },
        nfs: {
            hosts_allow: options.nfsHostsAllow,
            hosts_deny: options.nfsHostsDeny,
            log: LOG,
            fd_cache: new LRU({
                dispose: (key, n: any) => {
                    fs.close(n.fd, function on_close(err) {
                        if (err) LOG.debug(err, 'failed to close(fd=%d) for %s', n.fd, key)
                    })
                },
                max: 10000,
                maxAge: 60000 // 1m TTL
            }),
            fhdb,
            vfspath: process.cwd(),
            fs: options.fs
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

export const Portmap = {
    launchPortmapServer(options?: {
        nfsPort?: number
        mountPort?: number
        portmapPort?: number
    }): Promise<{ dispose: () => Promise<void> }> {
        return new Promise((resolve, reject) => {
            const nfsPort = options && options.nfsPort ? options.nfsPort : 2049
            const mountPort = options && options.mountPort ? options.mountPort : 1892
            const portmapPort = options && options.portmapPort ? options.portmapPort : 111

            const cfg = configurePortmap(nfsPort, mountPort, portmapPort)

            var pmapd = portmap.createPortmapServer(cfg)

            pmapd.on('error', function(e: any) {
                reject(e)
            })

            pmapd.listen(cfg.port, cfg.address, () => {
                console.log('Portmap server listening on:', { address: '0.0.0.0', port: portmapPort })
                resolve()
            })
        })
    },
    registerWithRunningPortmapper(options?: { nfsPort?: number; mountPort?: number; portmapPort?: number }): Promise<void> {
        return new Promise((resolve, reject) => {
            const nfsPort = options && options.nfsPort ? options.nfsPort : 2049
            const mountPort = options && options.mountPort ? options.mountPort : 1892
            const portmapPort = options && options.portmapPort ? options.portmapPort : 111

            const cfg = configurePortmap(nfsPort, mountPort, portmapPort)
            // The Linux portmapper normally rejects requests that are not
            // made to the loopback address.
            cfg.url = util.format('udp://127.0.0.1:%d', cfg.port)

            var pmapclient = portmap.createPortmapClient(cfg)

            pmapclient.on('error', (e: any) => {
                reject(e)
            })

            pmapclient.once('connect', () => {
                const mntmapping = {
                    prog: 100005,
                    vers: 3,
                    prot: 6,
                    port: mountPort
                }
                const nfsmapping = {
                    prog: 100003,
                    vers: 3,
                    prot: 6,
                    port: nfsPort
                }

                pmapclient.set(mntmapping, (err1: any) => {
                    if (err1) {
                        pmapclient.close()
                        reject(err1)
                        return
                    }

                    pmapclient.set(nfsmapping, (err2: any) => {
                        if (err2) {
                            // ..should we clean up the mntmapping?
                            pmapclient.close()
                            reject(err2)
                            return
                        }

                        pmapclient.close()
                        resolve()
                    })
                })
            })
        })
    },
    unregisterFromRunningPortmapper(options?: { nfsPort?: number; mountPort?: number; portmapPort?: number }): Promise<void> {
        return new Promise((resolve, reject) => {
            const nfsPort = options && options.nfsPort ? options.nfsPort : 2049
            const mountPort = options && options.mountPort ? options.mountPort : 1892
            const portmapPort = options && options.portmapPort ? options.portmapPort : 111

            const cfg = configurePortmap(nfsPort, mountPort, portmapPort)
            // The Linux portmapper normally rejects requests that are not
            // made to the loopback address.
            cfg.url = util.format('udp://127.0.0.1:%d', cfg.port)

            var pmapclient = portmap.createPortmapClient(cfg)

            pmapclient.once('error', (e: any) => {
                reject(e)
            })

            pmapclient.once('connect', () => {
                const mntmapping = {
                    prog: 100005,
                    vers: 3,
                    prot: 6,
                    port: mountPort
                }
                const nfsmapping = {
                    prog: 100003,
                    vers: 3,
                    prot: 6,
                    port: nfsPort
                }

                pmapclient.unset(mntmapping, (err1: any) => {
                    pmapclient.unset(nfsmapping, (err2: any) => {
                        if (err1) {
                            reject(err1)
                        } else if (err2) {
                            reject(err2)
                        } else {
                            resolve()
                        }
                    })
                })
            })
        })
    }
}

export function launchMountAndNfsServer(
    dsFs: FS,
    db?: DB,
    options?: {
        nfsAddress?: string
        nfsPort?: number
        nfsHostsAllow?: string[]
        nfsHostsDeny?: string[]

        mountAddres?: string
        mountPort?: number
        mountHostsAllows?: string[]
        mountHostsDeny?: string[]
        allowMount?: (path: string) => boolean
    }
): Promise<{ dispose: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
        if (options) {
            var nfsAddress = options.nfsAddress
            var nfsPort = options.nfsPort
            var nfsHostsAllow = options.nfsHostsAllow
            var nfsHostsDeny = options.nfsHostsDeny

            var mountAddress = options.mountAddres
            var mountPort = options.mountPort
            var mountHostsAllow = options.mountHostsAllows
            var mountHostsDeny = options.mountHostsDeny
            var allowMount = options.allowMount
        }

        if (!nfsAddress) {
            var nfsAddress = '0.0.0.0'
        }
        if (!nfsPort) {
            var nfsPort = 2049
        }

        if (!mountAddress) {
            var mountAddress = '0.0.0.0'
        }
        if (!mountPort) {
            var mountPort = 1892
        }

        if (!db) {
            // Create an in-memory database
            let store = new Map<string, string>()
            db = {
                async get(key) {
                    if (!store.has(key)) {
                        return { error: 'NotFoundError' }
                    }
                    return { value: store.get(key) }
                },
                batch() {
                    let operations: { put: [string, string][]; del: string[] } = { put: [], del: [] }
                    let batcher = {
                        put(key: string, value: string) {
                            operations.put.push([key, value])
                            return batcher
                        },
                        del(key: string) {
                            operations.del.push(key)
                            return batcher
                        },
                        async write() {
                            operations.put.forEach(el => {
                                store.set(el[0], el[1])
                            })
                            operations.del.forEach(el => {
                                store.delete(el)
                            })
                        }
                    }
                    return batcher
                },
                close() {
                    store.clear()
                }
            }
        }

        // Create some configurations
        const cfg = configure({ fs: dsFs, db, nfsHostsAllow, nfsHostsDeny, mountHostsAllow, mountHostsDeny, allowMount })
        const fhdb = cfg.nfs.fhdb

        const cleanup = () => {
            return new Promise<void>((resolve, reject) => {
                // Close the database.
                fhdb.close(e => {
                    e ? reject(e) : resolve()
                })
            })
        }

        const mountd = createMountServer(cfg.mount)

        mountd.on('error', (e: any) => {
            reject(e)
        })

        mountd.listen(mountPort, mountAddress, () => {
            let mountAddress = mountd.address()
            console.log('mount server listening on: ', { address: mountAddress.address, port: mountAddress.port })

            const nfsd = createNfsServer(cfg.nfs)

            nfsd.on('error', (e: any) => {
                mountd.close()
                reject(e)
            })

            // nfsd needs to listen on the same IP as configured for the mountd
            nfsd.listen(nfsPort, nfsAddress, () => {
                let nfsAddress = nfsd.address()
                console.log('nfs server listening on: ', { address: nfsAddress.address, port: nfsAddress.port })
                resolve()
            })
        })

        return cleanup
    })
}
