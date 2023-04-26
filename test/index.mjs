'use strict'

import * as url from 'node:url'

import {
  writeFileSync,
  unlinkSync
} from 'node:fs'

import path from 'path'

import chai from 'chai'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import { rimraf } from 'rimraf'
import { mkdirp } from 'mkdirp'
import through from 'through2'

import watch from '../index.mjs'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const { expect } = chai

chai.use(sinonChai)

// Default delay on debounce
const TIMEOUT = 200

const WATCHERS = new Set()

describe('glob-watcher', () => {
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

  before(async () => {
    await mkdirp(FIXTURES_PATH)
    writeFileSync(CHANGED_FILE_PATH, '// file to be changed')
  })

  beforeEach(async () => {
    await mkdirp(FIXTURES_PATH)
    writeFileSync(CHANGED_FILE_PATH, '// file to be changed')
  })

  afterEach(async () => {
    await rimraf(FIXTURES_PATH)
  })

  after(async () => {
    await rimraf(FIXTURES_PATH)
  })

  before(async () => {
    WATCHERS.forEach(getHandleWatchersClose(WATCHERS))
  })

  beforeEach(async () => {
    WATCHERS.forEach(getHandleWatchersClose(WATCHERS))
  })

  afterEach(async () => {
    WATCHERS.forEach(getHandleWatchersClose(WATCHERS))
  })

  after(async () => {
    WATCHERS.forEach(getHandleWatchersClose(WATCHERS))
  })

  it('watches change events: no handler', (done) => {
    const watcher = watch(path.join(__dirname, '**/*.js'))

    watcher.once('change', (filePath) => {
      expect(filePath)
        .to.equal(CHANGED_FILE_PATH)

      done()
    })

    // We default `ignoreInitial` to true, so always wait for `on('ready')`
    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it('watches change events: w/ handler', (done) => {
    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', (next) => {
      next()
      done()
    })

    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it('watches add events: no handler', (done) => {
    try {
      removeFile()
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(e)
    }

    /**
     *  Requires resolved path
     */
    const watcher = watch(path.join(__dirname, '**/*.js'))

    watcher.once('add', (filePath) => {
      expect(filePath)
        .to.equal(CREATED_FILE_PATH)

      done()
    })

    watcher.on('ready', createFile)

    WATCHERS.add(watcher)
  })

  it('watches add events: w/ handler', (done) => {
    try {
      removeFile()
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(e)
    }

    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', (next) => {
      next()
      done()
    })

    watcher.on('ready', createFile)

    WATCHERS.add(watcher)
  })

  it('watches unlink events: no handler', (done) => {
    try {
      createFile()
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(e)
    }

    /**
     *  Requires resolved path
     */
    const watcher = watch(path.join(__dirname, '**/*.js'))

    watcher.once('unlink', (filePath) => {
      expect(filePath)
        .to.equal(CREATED_FILE_PATH)

      done()
    })

    // We default `ignoreInitial` to true, so always wait for `on('ready')`
    watcher.on('ready', removeFile)

    WATCHERS.add(watcher)
  })

  it('watches unlink events: w/ handler', (done) => {
    try {
      createFile()
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(e)
    }

    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', (next) => {
      next()
      done()
    })

    watcher.on('ready', removeFile)

    WATCHERS.add(watcher)
  })

  it('waits for completion signal before executing again', (done) => {
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

    watcher.on('ready', () => {
      for (let i = 0, j = 3; i < j; i = i + 1) timeouts.push(setTimeout(changeFile, ((i + 1) * TIMEOUT) * 2))
    })

    WATCHERS.add(watcher)
  })

  it('can signal completion with a stream', (done) => {
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

    watcher.on('ready', () => {
      for (let i = 0, j = 3; i < j; i = i + 1) timeouts.push(setTimeout(changeFile, ((i + 1) * TIMEOUT) * 2))
    })

    WATCHERS.add(watcher)
  })

  it('emits an error (w/ handler)', (done) => {
    const error = new Error()

    const watcher = watch(path.join(__dirname, '**/*.js'), (next) => {
      next(error)
    })

    watcher.on('error', (e) => {
      expect(e)
        .to.equal(error)

      done()
    })

    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it('does not emit an error (no handler)', (done) => {
    const error = new Error()

    const watcher = watch(path.join(__dirname, '**/*.js'), (next) => {
      next(error)
    })

    setTimeout(done, 500)

    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it('changes `queue` default', (done) => {
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

  it('changes `delay` default', (done) => {
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

    watcher.on('ready', () => {
      for (let i = 0, j = 24; i < j; i = i + 1) timeouts.push(setTimeout(changeFile, ((i + 1) * delay) * 0.5))
    })

    WATCHERS.add(watcher)
  }).timeout(5000)

  it('changes `ignoreInitial` default', (done) => {
    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', { ignoreInitial: false }, (next) => {
      next()
      done()
    })

    // Invokes callback on file discovery
    // No need for `watcher.on('ready', changeFile)`

    WATCHERS.add(watcher)
  })

  it('does not change `ignoreInitial` default when option value is `null`', (done) => {
    /**
     *  Does not require resolved path
     */
    const watcher = watch('./test/**/*.js', { ignoreInitial: null }, (next) => {
      next()
      done()
    })

    // `ignoreInitial` default is `true` so does not invoke callback on file discovery
    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it('watches one event', (done) => {
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

  it('watches several events', (done) => {
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

  it('negates globs after they have been added', (done) => {
    let timeout = null

    const GLOB = path.join(__dirname, '**/*.js')
    const EXCLUDED_PATH = '!' + CHANGED_FILE_PATH

    const globs = [
      GLOB,
      EXCLUDED_PATH
    ]

    const watcher = watch(globs)

    watcher.on('error', done)

    watcher.once('change', (filePath) => {
      if (timeout) clearTimeout(timeout)
      watcher.emit('error', new Error(`Observes change to ignored glob for file path ${filePath}`))
    })

    watcher.on('ready', changeFile)

    timeout = setTimeout(done, 500)

    WATCHERS.add(watcher)
  })

  it('watches globs added after they have been negated', (done) => {
    const GLOB = path.join(__dirname, '**/*.js')
    const EXCLUDED_PATH = '!' + CHANGED_FILE_PATH
    const INCLUDED_PATH = CHANGED_FILE_PATH

    const globs = [
      GLOB,
      EXCLUDED_PATH,
      INCLUDED_PATH
    ]

    const watcher = watch(globs)

    watcher.once('change', (filePath) => {
      expect(filePath)
        .to.equal(INCLUDED_PATH)

      done()
    })

    // We default `ignoreInitial` to true, so always wait for `on('ready')`
    watcher.on('ready', changeFile)

    WATCHERS.add(watcher)
  })

  it('does not mutate glob array', (done) => {
    const GLOB = path.join(__dirname, '**/*.js')
    const EXCLUDED_PATH = '!' + CHANGED_FILE_PATH
    const INCLUDED_PATH = CHANGED_FILE_PATH

    const globs = [
      GLOB,
      EXCLUDED_PATH,
      INCLUDED_PATH
    ]

    const watcher = watch(globs)

    watcher.once('change', () => {
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

  it('ignores one glob', (done) => {
    let timeout = null
    const spy = sinon.spy(changeFile)

    /**
     *  Glob and ignored paths must both be resolved, or neither resolved
     */
    const ignored = './test/fixtures/changed.js'

    const watcher = watch('./test/**/*.js', { ignored })

    watcher.on('error', done)

    watcher.once('change', (filePath) => {
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

  it('ignores several globs', (done) => {
    let timeout = null
    const spy = sinon.spy(changeFile)

    /**
     *  Glob and ignored paths must both be resolved, or neither resolved
     */
    const ignored = ['./test/fixtures/changed.js', './test/fixtures/created.js']

    const watcher = watch('./test/**/*.js', { ignored })

    watcher.on('error', done)

    watcher.once('change', (filePath) => {
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
  it('ignores globs in the current working directory when they are negated', (done) => {
    let timeout = null
    const spy = sinon.spy(changeFile)

    const globs = ['./fixtures/**', '!./fixtures/changed.js']

    const watcher = watch(globs, { cwd: './test' })

    watcher.on('error', done)

    watcher.once('change', (filePath) => {
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
  it('ignores globs in the current working directory when they are ignored', (done) => {
    let timeout = null
    const spy = sinon.spy(changeFile)

    const watcher = watch('./fixtures/**', { ignored: ['./fixtures/*.js'], cwd: './test' })

    watcher.on('error', done)

    watcher.once('change', (filePath) => {
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
