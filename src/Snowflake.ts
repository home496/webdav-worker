export class Snowflake {
		private workerId: number;
		private datacenterId: number;
		private sequence: number;
		private lastTimestamp: number;

		private static readonly twepoch = 1288834974657; // Twitter 的纪元
		private static readonly sequenceBits = 12; // 序列号的位数
		private static readonly workerIdBits = 5; // 工作节点 ID 的位数
		private static readonly datacenterIdBits = 5; // 数据中心 ID 的位数
		private static readonly maxWorkerId = -1 ^ (-1 << Snowflake.workerIdBits); // 最大工作节点 ID
		private static readonly maxDatacenterId = -1 ^ (-1 << Snowflake.datacenterIdBits); // 最大数据中心 ID
		private static readonly workerIdShift = Snowflake.sequenceBits; // 工作节点 ID 的移位
		private static readonly datacenterIdShift = Snowflake.sequenceBits + Snowflake.workerIdBits; // 数据中心 ID 的移位
		private static readonly timestampShift = Snowflake.sequenceBits + Snowflake.workerIdBits + Snowflake.datacenterIdBits; // 时间戳的移位

		constructor(workerId: number, datacenterId: number) {
				if (workerId > Snowflake.maxWorkerId || workerId < 0) {
						throw new Error(`worker ID must be between 0 and ${Snowflake.maxWorkerId}`);
				}
				if (datacenterId > Snowflake.maxDatacenterId || datacenterId < 0) {
						throw new Error(`datacenter ID must be between 0 and ${Snowflake.maxDatacenterId}`);
				}
				this.workerId = workerId;
				this.datacenterId = datacenterId;
				this.sequence = 0;
				this.lastTimestamp = -1;
		}

		public nextId(): string {
				let timestamp = this.currentTimeMillis();

				if (timestamp < this.lastTimestamp) {
						throw new Error("Clock moved backwards. Refusing to generate id.");
				}

				if (this.lastTimestamp === timestamp) {
						this.sequence = (this.sequence + 1) & Snowflake.maxWorkerId;
						if (this.sequence === 0) {
								timestamp = this.waitNextMillis(this.lastTimestamp);
						}
				} else {
						this.sequence = 0;
				}

				this.lastTimestamp = timestamp;

				const id = (BigInt(timestamp - Snowflake.twepoch) << BigInt(Snowflake.timestampShift)) |
						(BigInt(this.datacenterId) << BigInt(Snowflake.datacenterIdShift)) |
						(BigInt(this.workerId) << BigInt(Snowflake.workerIdShift)) |
						BigInt(this.sequence);

				return id.toString(); // 返回字符串形式的 ID
		}

		private waitNextMillis(lastTimestamp: number): number {
				let timestamp = this.currentTimeMillis();
				while (timestamp <= lastTimestamp) {
						timestamp = this.currentTimeMillis();
				}
				return timestamp;
		}

		private currentTimeMillis(): number {
				return new Date().getTime();
		}
}
