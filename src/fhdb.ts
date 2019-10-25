// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as util from 'util'

import * as assert from 'assert-plus'
import * as once from 'once'
import * as uuidv4 from 'uuid/v4'
import { EventEmitter } from 'events'
import { NFS3ERR_STALE, NFS3ERR_BADHANDLE, NFS3ERR_SERVERFAULT } from '@diginet/nfs'
import { FS } from '@diginet/ds-fs'

///--- Globals

// DB key for pathname to uuid mapping
var FHANDLE_KEY_FMT = ':fh:%s'
// DB key for uuid to pathname mapping
var FNAME_KEY_FMT = ':fn:%s'

// file handle mapping

// XXX need comment
//

///--- API

type Batcher = {
    put(key: string, value: string): Batcher
    del(key: string): Batcher
    write(): Promise<void>
}

export interface DB {
    get(key: string): Promise<{ error?: 'NotFoundError'; value?: string }>

    batch(): Batcher

    close(cb: (err?: any) => void): void
}

export declare interface Fhdb extends EventEmitter {
    on(event: 'error', handler: (err: any) => void): this
    once(event: 'error', handler: (err: any) => void): this
    emit(event: 'error', err: any): boolean,
    removeListener(event: 'error', handler: (err: any) => void): this

    on(event: 'close', handler: () => void): this
    once(event: 'close', handler: () => void): this
    emit(event: 'close'): boolean,
    removeListener(event: 'close', handler: () => void): this
}

export class Fhdb extends EventEmitter {
    private db: DB
    _fhdb: boolean
    private fs: FS

    constructor(opts: { fs: FS; db: DB }) {
        super()

        assert.object(opts, 'options')

        this.fs = opts.fs
        this.db = opts.db

        this._fhdb = true // MDB flag
    }

    public async fhandle(fh: string) {
        assert.string(fh, 'fhandle')

        var k = util.format(FNAME_KEY_FMT, fh)

        let fname = await this.db.get(k)
        if (fname.error) {
            if (fname.error == 'NotFoundError') {
                throw { error: fname.error, nfsErrorCode: NFS3ERR_STALE }
            } else {
                throw { error: fname.error, nfsErrorCode: NFS3ERR_BADHANDLE }
            }
        }

        try {
            await new Promise((resolve, reject) => {
                this.fs.lstat(fname.value, err => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })
        } catch (err) {
            throw { error: err, nfsErrorCode: NFS3ERR_STALE }
        }
        return fname.value
    }

    /**
     * Retrieve the filehandle for a path.
     */
    public async lookup(filePath: string) {
        try {
            assert.string(filePath, 'path')

            var k1 = util.format(FHANDLE_KEY_FMT, filePath)

            try {
                await new Promise((resolve, reject) => {
                    this.fs.lstat(filePath, err => {
                        if (err) {
                            reject(err)
                        } else {
                            resolve()
                        }
                    })
                })
            } catch (err) {
                var lstatError = err
            }

            let _fhandle = await this.db.get(k1)
            if (_fhandle.error) {
                if (lstatError) {
                    throw { err: lstatError, nfsErrorCode: NFS3ERR_STALE }
                }

                // Existing file, create a file handle for it
                var _fh = uuidv4()
                var k2 = util.format(FNAME_KEY_FMT, _fh)
                try {
                    await this.db
                        .batch()
                        .put(k1, _fh)
                        .put(k2, filePath)
                        .write()
                    return _fh
                } catch (err2) {
                    throw { error: err2, nfsErrorCode: NFS3ERR_SERVERFAULT }
                }
            }

            if (lstatError) {
                this.del(k1, () => {})
                throw { err: lstatError, nfsErrorCode: NFS3ERR_STALE }
            }

            // already there
            return _fhandle.value
        } catch (err) {
            if (err.nfsErrorCode) {
                throw err
            }
            throw { error: err, nfsErrorCode: NFS3ERR_SERVERFAULT }
        }
    }

    /**
     * Takes care of cleaning up the old existing fhandle that might be
     * in the db and sets up the bookkeeping data for the new file.
     * The new file keeps the old file's fhandle.
     */
    public mv(oldpath: string, newpath: string, cb: (err: any) => void) {
        assert.string(oldpath, 'oldpath')
        assert.string(newpath, 'newpath')
        assert.func(cb, 'callback')

        // We can't use self.put here since we need to force the use of the old
        // _fhandle; update the db directly.
        let update_db = (p: string, _fhandle: string, _cb: (err: any) => void) => {
            let k1 = util.format(FHANDLE_KEY_FMT, p)
            let k2 = util.format(FNAME_KEY_FMT, _fhandle)

            this.db
                .batch()
                .put(k1, _fhandle)
                .put(k2, p)
                .write()
                .then(
                    () => {
                        _cb(null)
                    },
                    err2 => {
                        _cb(err2)
                    }
                )
        }

        let cleanup = () => {
            var fhk = util.format(FHANDLE_KEY_FMT, oldpath)
            // we can't delete the FNAME_KEY_FMT entry since that is already
            // setup to refer to the renamed file
            this.db
                .batch()
                .del(fhk)
                .write()
                .then(
                    () => {
                        cb(null)
                    },
                    err => {
                        cb(err)
                    }
                )
        }

        var k1 = util.format(FHANDLE_KEY_FMT, oldpath)
        this.db.get(k1).then(res => {
            if (!res.error) {
                // We can't use self.put here since we need to force the use
                // of the old _fhandle; update the db directly.
                update_db(newpath, res.value, u_err => {
                    if (u_err) {
                        cb(u_err)
                        return
                    }
                    cleanup()
                })
            } else {
                // oldpath not there
                var _fh = uuidv4()
                update_db(newpath, _fh, u_err => {
                    if (u_err) {
                        cb(u_err)
                        return
                    }
                    cb(null)
                })
            }
        })
    }

    public del(p: string, cb: (err?: any) => void) {
        assert.string(p, 'path')
        assert.func(cb, 'callback')

        cb = once(cb)

        let fhk = util.format(FHANDLE_KEY_FMT, p)

        this.db.get(fhk).then(
            _fhandle => {
                if (_fhandle.error) {
                    cb()
                    return
                }

                var fnk = util.format(FNAME_KEY_FMT, _fhandle.value)
                this.db
                    .batch()
                    .del(fhk)
                    .del(fnk)
                    .write()
                    .then(
                        () => {
                            cb(null)
                        },
                        err2 => {
                            cb(err2)
                        }
                    )
            }
        )
    }

    public close(cb: (err?: any) => void) {
        assert.optionalFunc(cb, 'callback')

        this.db.close(err => {
            if (err) {
                if (cb) {
                    cb(err)
                } else {
                    this.emit('error', err)
                }
            } else {
                this.emit('close')
                if (cb) cb()
            }
        })
    }
}
