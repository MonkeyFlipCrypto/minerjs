import Miner from './miner'
import { SHA256 } from 'crypto-js'

export default class Block {
	private miner: Miner
	protected nonce: number
	public index: number
	public timestamp: Date
	public data: string
	public preceedingHash: string
	public hash: string

	constructor(miner: Miner, index: number, timestamp: Date, data: string, preceedingHash: string) {
		this.miner = miner
		this.index = index
		this.timestamp = timestamp
		this.data = data
		this.preceedingHash = preceedingHash
		this.nonce = 0
		this.hash = this.computeHash()
	}

	computeHash(): string {
		return SHA256(this.index + this.preceedingHash + this.timestamp.toLocaleString('en-US', { timeZone: 'UTC' }) + JSON.stringify(this.data) + this.nonce).toString()
	}

	proofOfWork(diff: number) {
		while (this.hash.substring(0, diff) !== Array(diff + 1).join('0')) {
			this.nonce++
			this.hash = this.computeHash()
		}
	}

	async verify(): Promise<boolean> {
		try {
			const resp = await this.miner.request('/mine', {
				json: {
					hash: this.hash
				}
			})
			return true
		} catch (err) {
			return false
		}
	}
}
