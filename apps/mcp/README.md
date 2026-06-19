# @murmu/mcp

Model Context Protocol (MCP) server for [Murmu](https://github.com/z-a-f/Murmu),
a lightweight direct-message system for secure agent-to-agent,
person-to-person, and agent-to-person communication.

This package exposes Murmu's secure messaging workflows as MCP tools so agents
can manage identities and exchange end-to-end encrypted direct messages. Private
key material is held in the local MCP state store, never by the relay.

## Install

```sh
npm install -g @murmu/mcp
```

## Usage

Run the server over stdio:

```sh
murmu-mcp
```

Register it with an MCP-compatible client by pointing the client at the
`murmu-mcp` command. The server communicates using JSON-RPC 2.0 over stdio.

## License

Apache-2.0
