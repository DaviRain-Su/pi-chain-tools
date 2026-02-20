require("@nomicfoundation/hardhat-ethers");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
	solidity: {
		version: "0.8.24",
		settings: {
			optimizer: { enabled: true, runs: 200 },
		},
	},
	paths: {
		sources: "./contracts",
		tests: "./test",
		cache: "./cache",
		artifacts: "./artifacts",
	},
	networks: {
		hardhat: {},
		bscTestnet: {
			url: process.env.BSC_TESTNET_RPC_URL || "",
			accounts: process.env.BSC_TESTNET_PRIVATE_KEY
				? [process.env.BSC_TESTNET_PRIVATE_KEY]
				: [],
		},
		bscMainnet: {
			url: process.env.BSC_MAINNET_RPC_URL || "",
			accounts: process.env.BSC_MAINNET_PRIVATE_KEY
				? [process.env.BSC_MAINNET_PRIVATE_KEY]
				: [],
		},
	},
};
