import Block from './block'
import { MinerConfig, defaultConfig } from './config'
import got from 'got'
import { EventEmitter } from 'events'
import random from 'random'

interface RequestConfig {
	auth?: boolean
	responseStatus?: string
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
}

const REQ_MAP: Record<string, RequestConfig> = {
	'mine': {
		auth: true,
		responseStatus: 'user:mine',
		method: 'POST'
	},
	'info': {
		auth: false,
		responseStatus: 'general:info',
		method: 'GET'
	}
}

interface ResponseInfo {
	freeBlocks: number
	totalBlocks: number
	ownedBlocks: number
	difficulty: number
	lastClaimedTimestamp: string
	firstBlock: {
		index: number
		hash: string
		timestamp: string
	}
}

interface MiningOptions {
	count?: number
	startDate?: Date
	endDate?: Date
}

export interface MiningResults {
	found: number
	failed: number
	total: number
	startDate: Date
	endDate: Date
	totalTime: number
	foundBlocks: Block[]
}

export default class Miner extends EventEmitter {
	private blockchain: Block[] = []
	private diff: number = 4
	private cfg: MinerConfig

	constructor(cfg: MinerConfig = defaultConfig) {
		super()

		this.cfg = {
			...defaultConfig,
			...cfg
		}
	}

	obtainLatestBlock(): Block {
		return this.blockchain[this.blockchain.length - 1]
	}

	async mine(count: number = 1): Promise<MiningResults> {
		let owns = 0
		let info: ResponseInfo = await this.request('/info')
		if (this.diff !== info.difficulty) this.diff = info.difficulty

		const startDate = Date.now()
		const foundBlocks: Block[] = []
		const startCount = count

		while (count > 0) {
			info = await this.request('/info')
			let timestamp = new Date(new Date(info.lastClaimedTimestamp).toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
			const range = [this.diff, this.diff + Math.pow(info.totalBlocks, 2)]
			const rands = []
			let found = false

			while (found == false) {
				let rand = random.int(range[0], range[1])
				while (rands.indexOf(rand) == -1) rand = random.int(range[0], range[1])
				rands.push(rand)
				const block = this.addBlock(new Date(timestamp + rand))

				if (await block.verify()) {
					this.emit('block:found', block)
					owns++;
					found = true
					foundBlocks.push(block)
				} else {
					const index = this.blockchain.indexOf(block)
					if (index === -1) throw new Error('Failed to pop block, invalid index')
					this.blockchain.splice(index, 1)
				}
			}
			count--;
		}

		const endDate = Date.now()
		const totalTime = endDate - startDate

		const seqInfo: MiningResults = {
			found: foundBlocks.length,
			failed: foundBlocks.length - startCount,
			total: startCount,
			startDate: new Date(startDate),
			endDate: new Date(endDate),
			totalTime,
			foundBlocks
		}
		this.emit('mining:sequence', seqInfo)
		return seqInfo
	}

	async init(): Promise<void> {
		const resp: ResponseInfo = await this.request('/info')

		this.blockchain = []

		const block = new Block(this, resp.firstBlock.index, new Date(resp.firstBlock.timestamp), 'Initial block in chain', '0')
		block.hash = block.computeHash()
		if (block.hash !== resp.firstBlock.hash) throw new Error('Failed to recreate genesis block')
		this.blockchain.push(block)

		this.diff = resp.difficulty
	}

	addBlock(date: Date = new Date()): Block {
		const latestBlock = this.obtainLatestBlock()
		const block = new Block(this, latestBlock.index + 1, date, this.diff.toString(), latestBlock.hash)

		block.hash = block.computeHash()
		block.proofOfWork(this.diff)
		this.diff = (this.diff + (block.timestamp.getTime() - latestBlock.timestamp.getTime())) % 63

		this.blockchain.push(block)
		return block
	}

	async request(path: string, options?: any): Promise<any> {
		if (path.startsWith('/')) path = path.substring(1)

		const entry = REQ_MAP[path]
		if (!entry) {
			throw new Error(`Invalid request path: /${path}`)
		}
		try {
				let json = entry.method === 'POST' ? (options.json || {}) : undefined
				if (json && entry.auth) json = {
					...json,
					id: this.cfg.auth.id,
					key: this.cfg.auth.key
				}
				const resp = await got[entry.method.toLowerCase()]<any>(`${this.cfg.instance}/${path}`, {
					...options,
					responseType: 'json',
					json
				})

				if (resp.body.type !== entry.responseStatus) {
					throw new Error('Invalid response type')
				}

				return resp.body.data
		} catch (err) {
			const { response } = err

			if (response && response.body && response.body.status && response.body.type !== entry.responseStatus) {
				err.name = 'MonkeyFlipHTTPError'
				err.message = response.body.detail
			}

			throw err
		}
	}
}
