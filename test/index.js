'use strict'

const {
  writeFileSync,
  unlinkSync
} = require('node:fs')

const path = require('path')

const chai = require('chai')
const { expect } = chai
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const { rimraf } = require('rimraf')
const { mkdirp } = require('mkdirp')
const through = require('through2')

chai.use(sinonChai)

const watch = require('../')

// Default delay on debounce
const TIMEOUT = 200

const WATCHERS = new Set()

describe('glob-watcher', function () {
  const FIXTURES_PATH = path.join(__dirname, 'fixtures')
  const CHANGED_FILE_PATH = path.join(FIXTURES_PATH, 'changed.js')
  const CREATED_FILE_PATH = path.join(FIXTURES_PATH, 'created.js')

  function getHandleWatchersClose (watchers = new Set()) {
    return function handleWatcherClose (watcher) {
      if (!watcher.closed) watcher.close()
      watchers.delete(watcher)
    }
  }

  function changeFile () {
    writeFileSync(CHANGED_FILE_PATH, '// file changed')
  }

  function createFile () {
    writeFileSync(CREATED_FILE_PATH, '// file created')
  }

  function removeFile () {
    unlinkSync(CREATED_FILE_PATH)
  }

  before(async function () {
    await mkdirp(FIXTURES_PATH)
    writeFileSync(CHANGED_FILE_PATH, '// file to be changed')
  })

  beforeEach(async function () {
    await mkdirp(FIXTURES_PATH)
    writeFileSync(CHANGED_FILE_PATH, '// file to be changed')
  })

  afterEach(async function () {
    await rimraf(FIXTURES_PATH)
  })

  after(async function () {
    await rimraf(FIXTURES_PATH)
  })

  before(async function () {
    WATCHERS.forEach(getHandleWatchersClose(WATCHERS))
  })

  beforeEach(async function () {
    WATCHERS.forEach(getHandleWatchersClose(WATCHERS))
  })

  afterEach(async function () {
    WATCHERS.forEach(getHandleWatchersClose(WATCHERS))
  })

  after(async function () {
    WATCHERS.forEach(getHandleWatchersClose(WATCHERS))
  })

  it.only('watches change events: no handler', function (done) {
    const watcher = watch(path.join(__dirname, '**/*.js'))

    watcher.once('change', function (filePath) {
      expect(filePath)
        .to.equal(CHANGED_FILE_PATH)

      done()
    })

    // We default `ignoreInitial` to true, so always wait for `on('ready')`
    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it.only('watches change events: w/ handler', function (done) {
    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', function (next) {
      next()
      done()
    })

    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it.only('watches add events: no handler', function (done) {
    try {
      removeFile()
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(e)
    }

    /**
     *  Requires resolved path
     */
    const watcher = watch(path.join(__dirname, '**/*.js'))

    watcher.once('add', function (filePath) {
      expect(filePath)
        .to.equal(CREATED_FILE_PATH)

      done()
    })

    watcher.on('ready', createFile)

    WATCHERS.add(watcher)
  })

  it.only('watches add events: w/ handler', function (done) {
    try {
      removeFile()
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(e)
    }

    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', function (next) {
      next()
      done()
    })

    watcher.on('ready', createFile)

    WATCHERS.add(watcher)
  })

  it.only('watches unlink events: no handler', function (done) {
    try {
      createFile()
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(e)
    }

    /**
     *  Requires resolved path
     */
    const watcher = watch(path.join(__dirname, '**/*.js'))

    watcher.once('unlink', function (filePath) {
      expect(filePath)
        .to.equal(CREATED_FILE_PATH)

      done()
    })

    // We default `ignoreInitial` to true, so always wait for `on('ready')`
    watcher.on('ready', removeFile)

    WATCHERS.add(watcher)
  })

  it.only('watches unlink events: w/ handler', function (done) {
    try {
      createFile()
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(e)
    }

    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', function (next) {
      next()
      done()
    })

    watcher.on('ready', removeFile)

    WATCHERS.add(watcher)
  })

  it.only('waits for completion signal before executing again', function (done) {
    const timeouts = []

    const spy = sinon.stub()
      .onFirstCall().callsFake((next) => {
        setTimeout(next, TIMEOUT * 2)
      })
      .onSecondCall().callsFake((next) => {
        while (timeouts.length) clearTimeout(timeouts.shift())

        next()

        done()
      })

    const watcher = watch(path.join(__dirname, '**/*.js'), spy)

    watcher.on('ready', function () {
      for (let i = 0, j = 3; i < j; i = i + 1) timeouts.push(setTimeout(changeFile, ((i + 1) * TIMEOUT) * 2))
    })

    WATCHERS.add(watcher)
  })

  it.only('can signal completion with a stream', function (done) {
    const timeouts = []

    const spy = sinon.stub()
      .onFirstCall().callsFake((next) => {
        next()

        const stream = through()
        setImmediate(() => stream.end())
        return stream
      })
      .onSecondCall().callsFake((next) => {
        while (timeouts.length) clearTimeout(timeouts.shift())

        next()

        done()
      })

    const watcher = watch(path.join(__dirname, '**/*.js'), spy)

    watcher.on('ready', function () {
      for (let i = 0, j = 3; i < j; i = i + 1) timeouts.push(setTimeout(changeFile, ((i + 1) * TIMEOUT) * 2))
    })

    WATCHERS.add(watcher)
  })

  xit('emits an error if one occurs in the callback and handler attached', function (done) {
    const expectedError = new Error('boom')

    const watcher = watch(path.join(__dirname, '**/*.js'), function (next) {
      next(expectedError)
    })

    watcher.on('error', function (e) {
      expect(e)
        .to.equal(expectedError)

      done()
    })

    // We default `ignoreInitial` to true, so always wait for `on('ready')`
    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  xit('does not emit an error (and crash) when no handlers attached', function (done) {
    const expectedError = new Error('boom')

    const watcher = watch(path.join(__dirname, '**/*.js'), function (next) {
      next(expectedError)
      setTimeout(done, TIMEOUT * 3)
    })

    // We default `ignoreInitial` to true, so always wait for `on('ready')`
    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it.only('changes `queue` default', function (done) {
    const spy = sinon.stub()
      .onFirstCall().callsFake((next) => {
        next()

        changeFile()
      })
      .onSecondCall().callsFake((next) => {
        next()

        changeFile()
      })
      .onThirdCall().callsFake((next) => {
        next()

        done()
      })

    const watcher = watch(path.join(__dirname, '**/*.js'), { queue: false }, spy)

    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  }).timeout(5000)

  it.only('changes `delay` default', function (done) {
    const timeouts = []
    const delay = 100

    const spy = sinon.stub()
      .onFirstCall().callsFake((next) => {
        next()
      })
      .onSecondCall().callsFake((next) => {
        next()
      })
      .onThirdCall().callsFake((next) => {
        while (timeouts.length) clearTimeout(timeouts.shift())

        next()

        done()
      })

    // The delay to wait before triggering the handler
    const watcher = watch(path.join(__dirname, '**/*.js'), { delay }, spy)

    watcher.on('ready', function () {
      for (let i = 0, j = 24; i < j; i = i + 1) timeouts.push(setTimeout(changeFile, ((i + 1) * delay) * 0.5))
    })

    WATCHERS.add(watcher)
  }).timeout(5000)

  it.only('changes `ignoreInitial` default', function (done) {
    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', { ignoreInitial: false }, function (next) {
      next()
      done()
    })

    // Invokes callback on file discovery
    // No need for `watcher.on('ready', changeFile)`

    WATCHERS.add(watcher)
  })

  it.only('does not change `ignoreInitial` default when option value is `null`', function (done) {
    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', { ignoreInitial: null }, function (next) {
      next()
      done()
    })

    // `ignoreInitial` default is `true` so does not invoke callback on file discovery
    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it.only('watches one event', function (done) {
    const glob = './test/**/*.js'

    const spy = sinon.stub()
      .callsFake((next) => {
        next()

        removeFile()
      })

    /**
     *  Does not require resolved path
     */
    const watcher = watch(glob, { events: 'add' }, spy)

    watcher.on('ready', () => {
      createFile()

      setTimeout(() => {
        expect(spy.callCount)
          .to.equal(1)

        done()
      }, 500)
    })

    WATCHERS.add(watcher)
  })

  it.only('watches several events', function (done) {
    const glob = './test/**/*.js'

    const spy = sinon.stub()
      .onFirstCall().callsFake((next) => {
        next()

        createFile()
      })
      .onSecondCall().callsFake((next) => {
        next()

        removeFile()
      })
      .onThirdCall().callsFake((next) => {
        next()

        done()
      })

    /**
     *  Does not require resolved path
     */
    const watcher = watch(glob, { events: ['add', 'unlink', 'change'] }, spy)

    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  xit('negates globs after they have been added', function (done) {
    let timeout = null

    const GLOB = path.join(__dirname, '**/*.js')
    const EXCLUDED_PATH = '!' + CHANGED_FILE_PATH

    const globs = [
      GLOB,
      EXCLUDED_PATH
    ]

    const watcher = watch(globs)

    watcher.on('error', done)

    watcher.once('change', function (filePath) {
      if (timeout) clearTimeout(timeout)
      watcher.emit('error', new Error(`Observes change to ignored glob for file path ${filePath}`))
    })

    watcher.on('ready', changeFile)

    timeout = setTimeout(done, 500)

    WATCHERS.add(watcher)
  })

  it.only('watches globs added after they have been negated', function (done) {
    const GLOB = path.join(__dirname, '**/*.js')
    const EXCLUDED_PATH = '!' + CHANGED_FILE_PATH
    const INCLUDED_PATH = CHANGED_FILE_PATH

    const globs = [
      GLOB,
      EXCLUDED_PATH,
      INCLUDED_PATH
    ]

    const watcher = watch(globs)

    watcher.once('change', function (filePath) {
      expect(filePath)
        .to.equal(INCLUDED_PATH)

      done()
    })

    // We default `ignoreInitial` to true, so always wait for `on('ready')`
    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it.only('does not mutate glob array', function (done) {
    const GLOB = path.join(__dirname, '**/*.js')
    const EXCLUDED_PATH = '!' + CHANGED_FILE_PATH
    const INCLUDED_PATH = CHANGED_FILE_PATH

    const globs = [
      GLOB,
      EXCLUDED_PATH,
      INCLUDED_PATH
    ]

    const watcher = watch(globs)

    watcher.once('change', function () {
      expect(globs[0])
        .to.equal(GLOB)

      expect(globs[1])
        .to.equal(EXCLUDED_PATH)

      expect(globs[2])
        .to.equal(INCLUDED_PATH)

      done()
    })

    // We default `ignoreInitial` to true, so always wait for `on('ready')`
    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it.only('ignores one glob', function (done) {
    let timeout = null
    const spy = sinon.spy(changeFile)

    /**
     *  Glob and ignored paths must both be resolved, or neither resolved
     */
    const ignored = './test/fixtures/changed.js'

    const watcher = watch('./test/**/*.js', { ignored })

    watcher.on('error', done)

    watcher.once('change', function (filePath) {
      if (timeout) clearTimeout(timeout)
      watcher.emit('error', new Error(`Observes change to ignored glob for file path ${filePath}`))
    })

    watcher.on('ready', spy)

    timeout = setTimeout(() => {
      expect(spy)
        .to.have.been.called

      done()
    }, 500)

    WATCHERS.add(watcher)
  })

  it.only('ignores several globs', function (done) {
    let timeout = null
    const spy = sinon.spy(changeFile)

    /**
     *  Glob and ignored paths must both be resolved, or neither resolved
     */
    const ignored = ['./test/fixtures/changed.js', './test/fixtures/created.js']

    const watcher = watch('./test/**/*.js', { ignored })

    watcher.on('error', done)

    watcher.once('change', function (filePath) {
      if (timeout) clearTimeout(timeout)
      watcher.emit('error', new Error(`Observes change to ignored glob for file path ${filePath}`))
    })

    watcher.on('ready', spy)

    timeout = setTimeout(() => {
      expect(spy)
        .to.have.been.called

      done()
    }, 500)

    WATCHERS.add(watcher)
  })

  // https://github.com/gulpjs/glob-watcher/issues/46
  xit('ignores globs in the current working directory when they are negated', function (done) {
    let timeout = null
    const spy = sinon.spy(changeFile)

    const globs = ['./fixtures/**', '!./fixtures/*.js']

    const watcher = watch(globs, { cwd: './test' })

    watcher.on('error', done)

    watcher.once('change', function (filePath) {
      if (timeout) clearTimeout(timeout)
      watcher.emit('error', new Error(`Observes change to ignored glob for file path ${filePath}`))
    })

    watcher.on('ready', spy)

    timeout = setTimeout(() => {
      expect(spy)
        .to.have.been.called

      done()
    }, 500)

    WATCHERS.add(watcher)
  })

  // https://github.com/gulpjs/glob-watcher/issues/46
  it.only('ignores globs in the current working directory when they are ignored', function (done) {
    let timeout = null
    const spy = sinon.spy(changeFile)

    const watcher = watch('./fixtures/**', { ignored: ['./fixtures/*.js'], cwd: './test' })

    watcher.on('error', done)

    watcher.once('change', function (filePath) {
      if (timeout) clearTimeout(timeout)
      watcher.emit('error', new Error(`Observes change to ignored glob for file path ${filePath}`))
    })

    watcher.on('ready', spy)

    timeout = setTimeout(() => {
      expect(spy)
        .to.have.been.called

      done()
    }, 500)

    WATCHERS.add(watcher)
  })
})
