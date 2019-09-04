# ds-nfs-fs
Exposes a ds-fs file system over NFS (v3 only), and allows a client to mount the file system.

## Usage

### Portmapper

The RPC protocol behind NFS, ONC RPC, uses a portmapper server to tell connecting clients which ports to connect to. This portmapper is usually listening on port 111. When launching our NFS server, we need to make sure that the portmapper server is running, and is configured with our own ports.

On some systems, the portmapper server is already running as a background service, and we will in that case need to register our own configuration with the running service. On other systems, the portmapper is not running and we would then need to launch the server. One way to tell which is to simply attempt to launch the portmap server on port 111 - if it returns an error "EADDRINUSE", we know that the portmapper is already running and we should register with the portmap service.

Here is how that would be done:

```typescript
import * as nfs from '@diginet/ds-nfs-fs'

async function main() {
    try {
        await nfs.Portmap.launchPortmapServer()
    }
    catch (e) {
        if (e.code === 'EADDRINUSE') {
            await nfs.Portmap.registerWithRunningPortmapper()
        }
        else {
            throw e
        }
    }
}

main()
```

In this example, the default ports of 2049 for NFS, 1892 for mount and 111 for portmapper are used since we are not passing any options.

It is possible to pass an options object, where the  following properties can be included:

- nfsPort - The port where our NFS server will listen. Default: 2049
- mountPort - The port where our mount server will listen. Default: 1892
- portmapPort - The port where the portmapper should listen, or where the already running portmapper is listening. Default: 111

```typescript
const options = { nfsPort: 2345, mountPort: 3000, portmapPort: 9999  }

await nfs.Portmap.launchPortmapServer(options)
// Or..
await nfs.Portmap.registerWithRunningPortmapper(options)
```

If we registered with a running portmapper, we should unregister from the running portmapper server when we are done. If we don't, the modifications will remain. It is important to specify the same options as before (or empty, if we did not pass any options before).

``` typescript
await nfs.Portmap.unregisterFromRunningPortmapper(options)
```

When we are done setting up the portmapper, we can launch our NFS server.

### NFS server

```typescript
import * as nfs from '@diginet/ds-nfs-fs'
import * as dsFs from '@diginet/ds-fs'

dsFs.configure({ ... }, async () => {
    const fs = dsFs.BFSRequire('fs')
    const dispose = await nfs.launchMountAndNfsServer(fs)
    ...
    await dispose()
})
```

This will launch the NFS server.

The following options can be included:

- nfsAddress - The address for the NFS server to listen on. Default: "0.0.0.0"
- nfsPort - The port for the NFS server to listen on. Default: 2049
- nfsHostsAllow (string array) - If specified, allows these IP addresses and does not allow any other addresses.
- nfsHostsDeny (string array) - If specified, denies these IP addresses.
- mountAddress - The address for the mount server to listen on. Default: "0.0.0.0"
- mountPort - The port for the mount server to listen on. Default: 1892
- mountHostsAllow (string array) - If specified, allows these IP addresses and does not allow any other addresses.
- mountHostsDeny (string array) - If specified, denies these IP addresses.
- allowMount - A function which takes in the path which the user attempts to mount, and returns a boolean or a promise that resolves to boolean. If specified, this function will be called when a user attempts to mount the filesystem. If the result is false, the mount request will be denied.

## Mounting the filesystem

Run the following command to mount:

```bash
sudo mount <address>:<server-path> <mount-dir>
```

For example:

```shell
sudo mount 127.0.0.1:/ /mount
```

This will mount a server running on the local machine into the directory /mount.

If an error occurs, make sure you have installed the package nfs-common (sudo apt-get install nfs-common).

### Mounting in Kubernetes:

See [Kubernetes volumes](https://kubernetes.io/docs/concepts/storage/volumes/) or the [NFS example](https://github.com/kubernetes/examples/tree/master/staging/volumes/nfs).

Note that it is not possible to mount NFS in kubernetes using the internal cluster DNS name. It is however possible to mount using the ClusterIP.

## Development

To build, run:

- `npm install`
- `tsc`

