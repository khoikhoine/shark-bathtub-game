import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelFeedGesture,createFeedGesture,pollFeedGesture,startFeedGesture} from './feed-gesture.ts';

test('hold waits 300ms then releases at most one portion every 250ms',()=>{
  const state=createFeedGesture();startFeedGesture(state,7,0);
  assert.equal(pollFeedGesture(state,299),false);assert.equal(pollFeedGesture(state,300),true);
  assert.equal(pollFeedGesture(state,549),false);assert.equal(pollFeedGesture(state,550),true);
  assert.equal(pollFeedGesture(state,799),false);assert.equal(pollFeedGesture(state,800),true);
  assert.equal(pollFeedGesture(state,1050),true);
});
test('a delayed frame does not emit a backlog or repeat twice at the same timestamp',()=>{
  const state=createFeedGesture();startFeedGesture(state,1,0);
  assert.equal(pollFeedGesture(state,10000),true);assert.equal(pollFeedGesture(state,10000),false);
  assert.equal(pollFeedGesture(state,10249),false);assert.equal(pollFeedGesture(state,10250),true);
});
test('cancel prevents further drops and a fresh press receives its own initial delay',()=>{
  const state=createFeedGesture();startFeedGesture(state,1,100);cancelFeedGesture(state);
  assert.equal(pollFeedGesture(state,10000),false);
  startFeedGesture(state,2,10000);assert.equal(pollFeedGesture(state,10299),false);assert.equal(pollFeedGesture(state,10300),true);
});
test('another pointer and duplicate starts cannot steal or postpone an active gesture',()=>{
  const state=createFeedGesture();startFeedGesture(state,1,0);
  startFeedGesture(state,2,200);assert.equal(state.pointerId,1);assert.equal(pollFeedGesture(state,300),true);
  startFeedGesture(state,1,500);assert.equal(pollFeedGesture(state,550),true);
});
