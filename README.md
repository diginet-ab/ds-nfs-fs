# ds-nfs-fs
Exposes ds-fs over NFS to allow mounting of GridFs file system in linux.

## Starting the server:
- Run npm install
- Run typescript compile
- Start the server with "node dist/index.js"

The server will look for environment variables "MONGODB_SERVICE_HOST" and "MONGODB_SERVICE_PORT", and if found, will directly connect to MongoDB via that address.

If those environment variables cannot be found, the server attempts to connect to the central server on the address specified in the environment varaibles "CENTRAL_SERVER_SERVICE_HOST" and "CENTRAL_SERVER_SERVICE_PORT". 

These environment variables should automatically be provided if running in a Kubernetes cluster.

The NFS server is then started. The ports 1892 (mountd), 2049 (nfs) and 111 (rpcbind) must be opened (all are TCP).

## Mounting the filesystem in ubuntu:

If the server is running on your local machine:

Run "sudo mount 127.0.0.1:/ /path"

If an error occurs, make sure you have installed the package nfs-common.

## Development

To build a Docker image, run:

- `npm install`

- `tsc`
- `npm run buildDocker`. For the command to work, you must be logged in with npm. For that, run `npm login`. The script reads your access file located at ~/.npmrc and copies it to the container in order to gain access to the private packages. 

This will build an image tagged viktorwestberg/decthings:ds-nfs-fs

