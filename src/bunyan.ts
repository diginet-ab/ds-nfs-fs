import * as path from 'path'
import * as _bunyan from 'bunyan'

var BUNYAN_SERIALIZERS = {
    err: _bunyan.stdSerializers.err,
    rpc_call: function serialize_rpc_call(c) {
        return c ? c.toString() : null
    },
    rpc_reply: function serialize_rpc_reply(r) {
        return r ? r.toString() : null
    }
}

export function createLogger(name?, stream?) {
    var l = _bunyan.createLogger({
        name: name || path.basename(process.argv[1]),
        level: (process.env.LOG_LEVEL as any) || 'debug',
        stream: stream || process.stdout,
        serializers: BUNYAN_SERIALIZERS
    })

    return l
}

export let bunyan = {
    createLogger,
    serializers: BUNYAN_SERIALIZERS
}
