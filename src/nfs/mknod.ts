// Copyright 2016 Joyent, Inc.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import * as nfs from '@diginet/nfs'

function mknod(req, res, next) {
    req.log.debug('mknod: entered')
    res.error(nfs.NFS3ERR_NOTSUPP)
    next(false)
}

export default function chain() {
    return [mknod]
}
