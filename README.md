## Prerequisites

Demo - https://youtu.be/0T_v2nctLmA?si=pT-25C07k_4lfIP2

1. Node.js and npm installed on your system.
2. Bitquery Free Developer Account with OAuth token (follow instructions here).
3. Wallet with some Base ETH for the transaction fees.
4. Wallet should also have some WETH. I have shown the demo with 0.001 WETH. BUt you can use any other amount.

## Steps to run the bot on your Local Machine

1. `git clone https://github.com/Akshat-cs/evm_mvp_bot.git`
2. `npm install`
3. Add your `WALLET_PRIVATE_KEY` and `BITQUERY_TOKEN` in the `.env.example` file and remove the .example extension. To get the OAuth Token follow these instructions [here](https://docs.bitquery.io/docs/authorisation/how-to-generate/).
4. Run this command in terminal to start the script `ts-node index.ts`. As soon as you run it, mempool trades will be start tracking in realtime and as soon as theres a buy trade of trade amount greater than 10$, the bot automatically sells our 50% of the holdings of the token.
