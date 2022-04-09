// eslint-disable-next-line import/no-extraneous-dependencies
import Promise from 'bluebird';
// eslint-disable-next-line import/no-extraneous-dependencies
import bunyan from 'bunyan';
// eslint-disable-next-line import/no-extraneous-dependencies
import { expect } from 'chai';
import crypto from 'crypto';
import ABGP from '../../consensus/main';
import {
  areNotUniqueHashes,
  generateRandomRecords,
  getUniqueDbItemsCount,
  getUniqueRoots,
  syncNodesBetweenEachOther
} from '../utils/helpers';

export default function testSuite(ctx: any = {}, nodesCount: number = 3) {
  beforeEach(async () => {
    ctx.keys = [];

    ctx.nodes = [];

    for (let i = 0; i < nodesCount; i++) {
      const node = crypto.createECDH('secp256k1');
      node.generateKeys();
      ctx.keys.push({
        privateKey: node.getPrivateKey().toString('hex'),
        publicKey: node.getPublicKey('hex', 'compressed')
      });
    }

    for (let index = 0; index < nodesCount; index++) {
      const instance = new ABGP({
        address: ctx.keys[index].publicKey,
        gossipInterval: {
          min: 150,
          max: 300
        },
        sendSignalToRandomPeer: false,
        logger: bunyan.createLogger({ name: 'abgp.logger', level: 60 }),
        privateKey: ctx.keys[index].privateKey
      });

      for (let i = 0; i < nodesCount; i++) {
        if (i !== index) {
          instance.nodeApi.join(ctx.keys[i].publicKey);
        }
      }
      ctx.nodes.push(instance);
    }
  });

  it('should sync state', async () => {
    const nodesWithRecords: ABGP[] = ctx.nodes.slice(0, 2);

    let totalRecordsGenerated = 0;

    for (const node of nodesWithRecords) {
      totalRecordsGenerated += generateRandomRecords(node).amount;
    }

    await syncNodesBetweenEachOther(ctx.nodes, totalRecordsGenerated, 10);

    const uniqueDbItemsCount = getUniqueDbItemsCount(ctx.nodes);
    expect(Object.keys(uniqueDbItemsCount).length).to.eq(0);

    const rootReduces = getUniqueRoots(ctx.nodes);
    expect(rootReduces.length).to.eq(1);

    const checkAllHashesAreSimilar = areNotUniqueHashes(ctx.nodes);
    expect(checkAllHashesAreSimilar).to.eq(false);
  });

  it('should sync after drop (f, in N = 2f + 1)', async () => {
    const majority = Math.ceil(ctx.nodes.length / 2) + 1;
    const nodesMajority: ABGP[] = ctx.nodes.slice(0, majority);
    const nodesMinor: ABGP[] = ctx.nodes.slice(majority);

    let totalRecordsGenerated = 0;

    for (const node of nodesMajority) {
      totalRecordsGenerated += generateRandomRecords(node).amount;
    }

    await syncNodesBetweenEachOther(ctx.nodes, totalRecordsGenerated, 10);

    for (const node of nodesMinor) {
      node.lastUpdateTimestamp = 0;
      node.lastUpdateTimestampIndex = 0;

      for (const key of node.db.keys()) {
        node.db.delete(key);
      }

      for (const peerNode of node.nodes.values()) {
        peerNode.lastUpdateTimestamp = 0;
        peerNode.lastUpdateTimestampIndex = 0;
      }

      node.stateRoot = '0';
    }

    await syncNodesBetweenEachOther(ctx.nodes, totalRecordsGenerated, 10);

    const rootReduces = getUniqueRoots(ctx.nodes);
    expect(rootReduces.length).to.eq(1);
  });

  it('should fail to sync fake state with fake private and public keys (f, in N = 2f + 1)', async () => {
    const majority = Math.floor(ctx.nodes.length / 2) + 1;
    const nodesMajority: ABGP[] = ctx.nodes.slice(0, majority);
    const nodesFail: ABGP[] = ctx.nodes.slice(majority);

    let totalRecordsGeneratedAmount = 0;
    const hashes = [];
    const failHashes = [];

    for (const node of nodesMajority) {
      const generated = generateRandomRecords(node);
      totalRecordsGeneratedAmount += generated.amount;
      hashes.push(...generated.hashes);
    }

    for (const node of nodesFail) {
      const c = crypto.createECDH('secp256k1');
      c.generateKeys();

      // @ts-ignore
      node.privateKey = c.getPrivateKey().toString('hex');

      // @ts-ignore
      node.publicKey = c.getPublicKey('hex', 'compressed');

      generateRandomRecords(node);
    }

    await syncNodesBetweenEachOther(ctx.nodes, totalRecordsGeneratedAmount, 10);

    for (const node of nodesMajority) {
      for (const hash of failHashes) {
        const failedRecord = node.db.get(hash);
        expect(failedRecord).to.eq(undefined);
      }
      for (const hash of hashes) {
        const record = node.db.get(hash);
        expect(record).to.not.eq(undefined);
      }
    }

    const rootReduces = getUniqueRoots(nodesMajority);
    expect(rootReduces.length).to.eq(1);
  });

  it('should fail to sync fake state with fake private key and real public key (f, in N = 2f + 1)', async () => {
    const majority = Math.floor(ctx.nodes.length / 2) + 1;
    const nodesMajority: ABGP[] = ctx.nodes.slice(0, majority);
    const nodesFail: ABGP[] = ctx.nodes.slice(majority);

    let totalRecordsGeneratedAmount = 0;
    const hashes = [];
    const failHashes = [];

    for (const node of nodesMajority) {
      const generated = generateRandomRecords(node);
      totalRecordsGeneratedAmount += generated.amount;
      hashes.push(...generated.hashes);
    }

    for (const node of nodesFail) {
      const c = crypto.createECDH('secp256k1');
      c.generateKeys();

      // @ts-ignore
      node.privateKey = c.getPrivateKey().toString('hex');

      const generated = generateRandomRecords(node);
      totalRecordsGeneratedAmount += generated.amount;
      failHashes.push(...generated.hashes);
    }

    await syncNodesBetweenEachOther(ctx.nodes, totalRecordsGeneratedAmount, 10);

    for (const node of nodesMajority) {
      for (const hash of failHashes) {
        const failedRecord = node.db.get(hash);
        expect(failedRecord).to.eq(undefined);
      }
      for (const hash of hashes) {
        const record = node.db.get(hash);
        expect(record).to.not.eq(undefined);
      }
    }

    const rootReduces = getUniqueRoots(ctx.nodes);
    expect(rootReduces.length).to.eq(1);
  });

  afterEach(async () => {
    await Promise.delay(1000);
  });
}
