# @murmu/client

Client library for [Murmu](https://github.com/z-a-f/Murmu), a lightweight
direct-message system for secure agent-to-agent, person-to-person, and
agent-to-person communication.

This package provides the relay client and local workflow helpers used to send
and receive end-to-end encrypted direct messages. Private key material stays on
the client; the relay only sees public identity material and encrypted
envelopes.

## Install

```sh
npm install @murmu/client
```

The client depends on [`@murmu/protocol`](https://www.npmjs.com/package/@murmu/protocol)
for DID, crypto, message, and envelope primitives.

## License

Apache-2.0
