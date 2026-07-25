const assert = require('node:assert/strict')
const { test, describe, beforeEach, afterEach } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { FrameStore } = require('../../backend/frameStore')

/**
 * Unit tests for FrameStore: the rolling history/forecast frame tracker and
 * PNG cache cleanup used by node_helper.js and DwdRvClient.
 */

let cacheDir

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MMM-RainfallMapDWD-test-'))
})

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true })
})

function touch(store, fileName) {
  fs.writeFileSync(path.join(store.cacheDir, fileName), '')
}

describe('FrameStore history', () => {
  test('accumulates frames in ascending time order regardless of insertion order', () => {
    const store = new FrameStore(cacheDir, 10)
    store.addHistoryFrame({ time: 300, fileName: 'c.png' })
    store.addHistoryFrame({ time: 100, fileName: 'a.png' })
    store.addHistoryFrame({ time: 200, fileName: 'b.png' })

    assert.deepEqual(
      store.history.map((f) => f.time),
      [100, 200, 300]
    )
  })

  test('trims oldest frames once maxHistoryFrames is exceeded and deletes their cache files', () => {
    const store = new FrameStore(cacheDir, 2)
    store.addHistoryFrame({ time: 100, fileName: 'a.png' })
    touch(store, 'a.png')
    store.addHistoryFrame({ time: 200, fileName: 'b.png' })
    touch(store, 'b.png')
    store.addHistoryFrame({ time: 300, fileName: 'c.png' })
    touch(store, 'c.png')

    assert.deepEqual(
      store.history.map((f) => f.fileName),
      ['b.png', 'c.png']
    )
    assert.ok(!fs.existsSync(path.join(cacheDir, 'a.png')), 'orphaned history file should be deleted')
    assert.ok(fs.existsSync(path.join(cacheDir, 'b.png')))
    assert.ok(fs.existsSync(path.join(cacheDir, 'c.png')))
  })

  test('replacing a frame at an existing timestamp deletes the old file', () => {
    const store = new FrameStore(cacheDir, 10)
    store.addHistoryFrame({ time: 100, fileName: 'old.png' })
    touch(store, 'old.png')
    store.addHistoryFrame({ time: 100, fileName: 'new.png' })
    touch(store, 'new.png')

    assert.equal(store.history.length, 1)
    assert.equal(store.history[0].fileName, 'new.png')
    assert.ok(!fs.existsSync(path.join(cacheDir, 'old.png')))
  })

  test('setMaxHistoryFrames re-trims immediately', () => {
    const store = new FrameStore(cacheDir, 5)
    for (let i = 0; i < 5; i++) {
      store.addHistoryFrame({ time: i, fileName: `${i}.png` })
      touch(store, `${i}.png`)
    }
    store.setMaxHistoryFrames(2)
    assert.deepEqual(
      store.history.map((f) => f.time),
      [3, 4]
    )
  })
})

describe('FrameStore forecast', () => {
  test('setForecastFrames replaces the whole list and deletes orphaned files', () => {
    const store = new FrameStore(cacheDir, 10)
    store.setForecastFrames([
      { time: 100, fileName: 'f1.png' },
      { time: 200, fileName: 'f2.png' }
    ])
    touch(store, 'f1.png')
    touch(store, 'f2.png')

    store.setForecastFrames([
      { time: 200, fileName: 'f2.png' },
      { time: 300, fileName: 'f3.png' }
    ])
    touch(store, 'f3.png')

    assert.ok(!fs.existsSync(path.join(cacheDir, 'f1.png')), 'frame no longer in the new set should be deleted')
    assert.ok(fs.existsSync(path.join(cacheDir, 'f2.png')), 'frame still present should be kept')
    assert.ok(fs.existsSync(path.join(cacheDir, 'f3.png')))
  })
})

describe('FrameStore snapshot', () => {
  test('getSnapshot returns bounds, history and forecast', () => {
    const store = new FrameStore(cacheDir, 10)
    store.setBounds({ south: 1, west: 2, north: 3, east: 4 })
    store.addHistoryFrame({ time: 1, fileName: 'a.png' })
    store.setForecastFrames([{ time: 2, fileName: 'b.png' }])

    const snapshot = store.getSnapshot()
    assert.deepEqual(snapshot.bounds, { south: 1, west: 2, north: 3, east: 4 })
    assert.equal(snapshot.history.length, 1)
    assert.equal(snapshot.forecast.length, 1)
  })
})
