/**
 * Type stub for @privy-io/node — optional dependency.
 *
 * This module is dynamically imported at runtime only when Privy
 * signer backend is selected. The actual types come from the SDK
 * when installed. This stub prevents TS2307 when it's not installed.
 */
declare module "@privy-io/node" {
	export class PrivyClient {
		constructor(appId: string, appSecret: string);
		wallets: {
			get(params: { id: string }): Promise<{ address: string }>;
			ethereum(): {
				sendTransaction(
					walletId: string,
					params: {
						caip2: string;
						params: {
							transaction: {
								to: string;
								data?: string;
								value?: string;
								gas?: string;
							};
						};
					},
				): Promise<{ hash: string }>;
			};
		};
	}
}
