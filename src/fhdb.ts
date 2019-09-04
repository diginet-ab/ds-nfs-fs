// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as fs from 'fs'
import * as path from 'path'
import * as util from 'util'

import * as assert from 'assert-plus'
import * as levelup from 'levelup'
import * as leveldown from 'leveldown'
import * as once from 'once'
import * as uuidv4 from 'uuid/v4'
import { EventEmitter } from 'events'
import {
    NFS3ERR_STALE,
    NFS3ERR_BADHANDLE,
    NFS3ERR_SERVERFAULT,
    NFS3ERR_NOENT,
    MNT3ERR_SERVERFAULT,
    MNT3ERR_NOENT
} from '@diginet/nfs'
import { FS } from '@diginet/ds-fs'

///--- Globals

var DB_NAME = 'fh.db'

// DB key for pathname to uuid mapping
var FHANDLE_KEY_FMT = ':fh:%s'
// DB key for uuid to pathname mapping
var FNAME_KEY_FMT = ':fn:%s'

// file handle mapping

// XXX need comment
//

///--- API

export default class Fhdb extends EventEmitter {
    db?: any
    log: any
    location: string
    _fhdb: boolean
    fs: FS

    constructor(opts: { log: any; location: string; fs: FS }) {
        super()

        assert.object(opts, 'options')
        assert.object(opts.log, 'options.log')
        assert.string(opts.location, 'options.location')

        this.db = null
        this.location = path.normalize(opts.location)
        this.log = opts.log.child(
            {
                component: 'fhandleDB',
                location: this.location
            },
            true
        )
        this.fs = opts.fs

        this._fhdb = true // MDB flag

        this.open()
    }

    public async fhandle(fh: string) {
        try {
            assert.string(fh, 'fhandle')

            var k = util.format(FNAME_KEY_FMT, fh)
            var log = this.log

            log.trace('fhandle(%s): entered', fh)
            try {
                var fname = await this.db.get(k)
            } catch (err) {
                log.trace(err, 'fhandle(%s): error', fh)
                if (err.type == 'NotFoundError') {
                    throw { error: err, nfsErrorCode: NFS3ERR_STALE }
                } else {
                    throw { error: err, nfsErrorCode: NFS3ERR_BADHANDLE }
                }
            }

            let fname_string = fname.toString()
            try {
                await new Promise((resolve, reject) => {
                    this.fs.lstat(fname_string, err => {
                        if (err) {
                            reject(err)
                        } else {
                            resolve()
                        }
                    })
                })
            } catch (err) {
                log.trace(err, 'fhandle(%s): error', fh)
                throw { error: err, nfsErrorCode: NFS3ERR_STALE }
            }
            log.trace('fhandle(%s): done => %s', fh, fname_string)
            return fname_string
        } catch (err) {
            if (err.nfsErrorCode) {
                throw err
            }
            throw { error: err, nfsErrorCode: NFS3ERR_SERVERFAULT }
        }
    }

    public async lookup(p: string) {
        try {
            assert.string(p, 'path')

            var log = this.log

            log.trace('lookup(%s): entered', p)
            var k1 = util.format(FHANDLE_KEY_FMT, p)

            try {
                await new Promise((resolve, reject) => {
                    this.fs.lstat(p, err => {
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

            try {
                var _fhandle = await this.db.get(k1)
            } catch (err) {
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
                        .put(k2, p)
                        .write()
                    log.trace('lookup(%s): done => %s', p, _fh)
                    return _fh
                } catch (err2) {
                    log.trace(err2, 'lookup(%s): failed', p)
                    throw { error: err2, nfsErrorCode: NFS3ERR_SERVERFAULT }
                }
            }

            if (lstatError) {
                this.del(k1, () => {})
                throw { err: lstatError, nfsErrorCode: NFS3ERR_STALE }
            }

            // already there
            let _fhandle_string = _fhandle.toString()
            log.trace('lookup(%s): done => %s', p, _fhandle_string)
            return _fhandle_string
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

        var self = this
        var log = this.log

        log.trace('cache mv(%s, %s): entered', oldpath, newpath)

        // We can't use self.put here since we need to force the use of the old
        // _fhandle; update the db directly.
        function update_db(p, _fhandle, _cb) {
            var k1 = util.format(FHANDLE_KEY_FMT, p)
            var k2 = util.format(FNAME_KEY_FMT, _fhandle)

            self.db
                .batch()
                .put(k1, _fhandle)
                .put(k2, p)
                .write(function onBatchWrite(err2) {
                    if (err2) {
                        log.error(err2, 'update_db(%s): failed', p)
                        _cb(err2)
                    } else {
                        log.trace('update_db(%s): done', p)
                        _cb(null)
                    }
                })
        }

        function cleanup() {
            var fhk = util.format(FHANDLE_KEY_FMT, oldpath)
            // we can't delete the FNAME_KEY_FMT entry since that is already
            // setup to refer to the renamed file
            self.db
                .batch()
                .del(fhk)
                .write(function onBatchDel(err) {
                    if (err) {
                        log.error(err, 'mv del %s: failed', oldpath)
                        cb(err)
                    } else {
                        cb(null)
                    }
                })
        }

        var k1 = util.format(FHANDLE_KEY_FMT, oldpath)
        self.db.get(k1, function(err, _fhandle) {
            if (!err) {
                // We can't use self.put here since we need to force the use
                // of the old _fhandle; update the db directly.
                update_db(newpath, _fhandle, function(u_err) {
                    if (u_err) {
                        cb(u_err)
                        return
                    }
                    cleanup()
                })
            } else {
                // oldpath not there
                var _fh = uuidv4()
                update_db(newpath, _fh, function(u_err) {
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

        var log = this.log
        var fhk = util.format(FHANDLE_KEY_FMT, p)

        log.trace('del(%s): entered', p)
        this.db.get(fhk, (err, _fhandle) => {
            if (err) {
                log.error(err, 'del(%s): failed', p)
                cb(err)
                return
            }

            if (!_fhandle) {
                cb()
                return
            }

            var fnk = util.format(FNAME_KEY_FMT, _fhandle)
            this.db
                .batch()
                .del(fhk)
                .del(fnk)
                .write(function onBatchDel(err2) {
                    if (err2) {
                        log.error(err2, 'del(%s): failed', p)
                        cb(err2)
                    }
                    cb(null)
                })
        })
    }

    private open() {
        var db_location = path.join(this.location, DB_NAME)
        var leveldownStore = leveldown(db_location)
        var log = this.log

        log.debug('open: entered')

        fs.mkdir(this.location, parseInt('0700', 8), err => {
            fs.mkdir(db_location, parseInt('0700', 8), err2 => {
                this.db = levelup(leveldownStore, {
                    valueEncoding: 'json'
                })

                this.db.on('error', this.emit.bind(this, 'error'))
                this.db.once('ready', () => {
                    log.debug('open: done')
                    this.emit('ready')
                })
            })
        })
    }

    public close(cb: (err?: any) => void) {
        assert.optionalFunc(cb, 'callback')

        var log = this.log
        var self = this

        var _cb = once(function(err) {
            if (err) {
                log.error(err, 'close: failed')
                if (cb) {
                    cb(err)
                } else {
                    self.emit('error', err)
                }
            } else {
                log.debug(err, 'close: done')
                self.emit('close')
                if (cb) cb()
            }
        })

        log.debug('close: entered')

        if (this.db) {
            this.db.close(_cb)
        } else {
            _cb()
        }
    }

    toString() {
        return '[object ' + this.constructor.name + '<' + 'location=' + this.location + '>]'
    }
}
