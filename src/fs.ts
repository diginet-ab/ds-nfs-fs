import { FS } from '@diginet/ds-fs'

let _dsFs: FS = null

export function getDsFs() {
    return _dsFs
}

export function setDsFs(dsFs: FS) {
    _dsFs = dsFs
}
