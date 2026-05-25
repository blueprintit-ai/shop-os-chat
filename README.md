# @blueprintit/shop-os-chat

Read-only branded chat surface for Shop OS Foundation vaults. Bundled with
the [Shop OS installer](https://github.com/blueprintit-ai/shop-os-installer).

## Usage

```sh
shop-os-chat "/path/to/Shop OS Vault"
```

Launches a local web server on the first free port in 7777-7790 and opens
the default browser. The customer's vault folder is the working directory
for all Claude Code calls. No `ANTHROPIC_API_KEY` is involved; auth uses
the customer's Claude Max subscription via Claude Code.

## License

UNLICENSED. Part of Blueprint IT's Shop OS Foundation product.
