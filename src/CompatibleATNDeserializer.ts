/*
 * This file is released under the MIT license.
 * Copyright (c) 2016, 2017, Mike Lischke
 *
 * See LICENSE file for more info.
 */

import { ATNDeserializer, ATNDeserializationOptions, ATN, ATNType, LoopEndState, BlockStartState, ATNStateType, InvalidState, ATNState, BlockEndState, DecisionState, RuleStartState, RuleStopState, TokensStartState, Transition, RuleTransition, EpsilonTransition, PlusLoopbackState, PlusBlockStartState, StarLoopbackState, StarLoopEntryState, LexerAction, LexerActionType, ActionTransition, LexerCustomAction, BasicBlockStartState, BasicState, AtomTransition, TransitionType, ParserATNSimulator, SetTransition, RangeTransition, NotSetTransition } from "antlr4ts/atn";
import { UUID, IntervalSet, Array2DHashSet, Interval, BitSet } from "antlr4ts/misc";
import { NotNull } from "antlr4ts/Decorators";
import { Token } from "antlr4ts";
import { DFA } from "antlr4ts/dfa/DFA";

/**
 * This derived deserializer makes loading of ATNs generated by standard ANTLR possible. The antlr4ts library uses
 * an incompatible version.
 * Unfortunately, we have to duplicate all the private stuff to make the class working.
 */
export class CompatibleATNDeserializer extends ATNDeserializer {
	private static readonly BASE_SERIALIZED_UUID2: UUID = UUID.fromString("E4178468-DF95-44D0-AD87-F22A5D5FB6D3");
	private static readonly ADDED_LEXER_ACTIONS2: UUID = UUID.fromString("AB35191A-1603-487E-B75A-479B831EAF6D");
	private static readonly ADDED_UNICODE_SMP2: UUID = UUID.fromString("59627784-3BE5-417A-B9EB-8131A7286089");

	private static readonly SUPPORTED_UUIDS2: UUID[] = [
		CompatibleATNDeserializer.BASE_SERIALIZED_UUID2,
		CompatibleATNDeserializer.ADDED_LEXER_ACTIONS2,
		CompatibleATNDeserializer.ADDED_UNICODE_SMP2
	];

	/**
	 * This is the current serialized UUID.
	 */
	private static readonly SERIALIZED_UUID2: UUID = CompatibleATNDeserializer.ADDED_UNICODE_SMP2;

	@NotNull
	private readonly deserializationOptions2: ATNDeserializationOptions;

	constructor(@NotNull deserializationOptions?: ATNDeserializationOptions) {
		super(deserializationOptions);
		if (deserializationOptions == null) {
			deserializationOptions = ATNDeserializationOptions.defaultOptions;
		}

		this.deserializationOptions2 = deserializationOptions;
	}

    protected isFeatureSupported(feature: UUID, actualUuid: UUID) {
        let featureIndex = CompatibleATNDeserializer.SUPPORTED_UUIDS2.findIndex(e => e.equals(feature));
        if (featureIndex < 0) {
            return false;
        }
        return CompatibleATNDeserializer.SUPPORTED_UUIDS2.findIndex(e => e.equals(actualUuid)) >= featureIndex;
    }

	deserialize(@NotNull data: Uint16Array): ATN {
		data = data.slice(0);

		// Each Uint16 value in data is shifted by +2 at the entry to this method. This is an encoding optimization
		// targeting the serialized values 0 and -1 (serialized to 0xFFFF), each of which are very common in the
		// serialized form of the ATN. In the modified UTF-8 that Java uses for compiled string literals, these two
		// character values have multi-byte forms. By shifting each value by +2, they become characters 2 and 1 prior to
		// writing the string, each of which have single-byte representations. Since the shift occurs in the tool during
		// ATN serialization, each target is responsible for adjusting the values during deserialization.
		//
		// As a special case, note that the first element of data is not adjusted because it contains the major version
		// number of the serialized ATN, which was fixed at 3 at the time the value shifting was implemented.
		for (let i = 1; i < data.length; i++) {
			data[i] = (data[i] - 2) & 0xFFFF;
		}

		let p: number = 0;
		let version: number = ATNDeserializer.toInt(data[p++]);
		if (version != ATNDeserializer.SERIALIZED_VERSION) {
			let reason = `Could not deserialize ATN with version ${version} (expected ${ATNDeserializer.SERIALIZED_VERSION}).`;
			throw new Error(reason);
		}

		let uuid: UUID = ATNDeserializer.toUUID(data, p);
		p += 8;
		if (CompatibleATNDeserializer.SUPPORTED_UUIDS2.findIndex(e => e.equals(uuid)) < 0) {
			let reason = `Could not deserialize ATN with UUID ${uuid} (expected ${CompatibleATNDeserializer.SERIALIZED_UUID2} or a legacy UUID).`;
			throw new Error(reason);
		}

		let supportsLexerActions: boolean = this.isFeatureSupported(CompatibleATNDeserializer.ADDED_LEXER_ACTIONS2, uuid);

		let grammarType: ATNType = ATNDeserializer.toInt(data[p++]);
		let maxTokenType: number = ATNDeserializer.toInt(data[p++]);
		let atn: ATN = new ATN(grammarType, maxTokenType);

		//
		// STATES
		//
		let loopBackStateNumbers: [LoopEndState, number][] = [];
		let endStateNumbers: [BlockStartState, number][] = [];
		let nstates: number = ATNDeserializer.toInt(data[p++]);
		for (let i = 0; i < nstates; i++) {
			let stype: ATNStateType = ATNDeserializer.toInt(data[p++]);
			// ignore bad type of states
			if (stype === ATNStateType.INVALID_TYPE) {
				atn.addState(new InvalidState());
				continue;
			}

			let ruleIndex: number = ATNDeserializer.toInt(data[p++]);
			if (ruleIndex === 0xFFFF) {
				ruleIndex = -1;
			}

			let s: ATNState = this.stateFactory(stype, ruleIndex);
			if (stype === ATNStateType.LOOP_END) { // special case
				let loopBackStateNumber: number = ATNDeserializer.toInt(data[p++]);
				loopBackStateNumbers.push([<LoopEndState>s, loopBackStateNumber]);
			}
			else if (s instanceof BlockStartState) {
				let endStateNumber: number = ATNDeserializer.toInt(data[p++]);
				endStateNumbers.push([s, endStateNumber]);
			}
			atn.addState(s);
		}

		// delay the assignment of loop back and end states until we know all the state instances have been initialized
		for (let pair of loopBackStateNumbers) {
			pair[0].loopBackState = atn.states[pair[1]];
		}

		for (let pair of endStateNumbers) {
			pair[0].endState = <BlockEndState>atn.states[pair[1]];
		}

		let numNonGreedyStates: number = ATNDeserializer.toInt(data[p++]);
		for (let i = 0; i < numNonGreedyStates; i++) {
			let stateNumber: number = ATNDeserializer.toInt(data[p++]);
			(<DecisionState>atn.states[stateNumber]).nonGreedy = true;
		}

		let numPrecedenceStates: number = ATNDeserializer.toInt(data[p++]);
		for (let i = 0; i < numPrecedenceStates; i++) {
			let stateNumber: number = ATNDeserializer.toInt(data[p++]);
			(<RuleStartState>atn.states[stateNumber]).isPrecedenceRule = true;
		}

		//
		// RULES
		//
		let nrules: number = ATNDeserializer.toInt(data[p++]);
		if (atn.grammarType === ATNType.LEXER) {
			atn.ruleToTokenType = new Int32Array(nrules);
		}

		atn.ruleToStartState = new Array<RuleStartState>(nrules);
		for (let i = 0; i < nrules; i++) {
			let s: number = ATNDeserializer.toInt(data[p++]);
			let startState: RuleStartState = <RuleStartState>atn.states[s];
			if (!startState) {
				let x = 0;
			}
			atn.ruleToStartState[i] = startState;
			if (atn.grammarType === ATNType.LEXER) {
				let tokenType: number = ATNDeserializer.toInt(data[p++]);
				if (tokenType === 0xFFFF) {
					tokenType = Token.EOF;
				}

				atn.ruleToTokenType[i] = tokenType;

				if (!this.isFeatureSupported(CompatibleATNDeserializer.ADDED_LEXER_ACTIONS2, uuid)) {
					// this piece of unused metadata was serialized prior to the
					// addition of LexerAction
					let actionIndexIgnored: number = ATNDeserializer.toInt(data[p++]);
					if (actionIndexIgnored === 0xFFFF) {
						actionIndexIgnored = -1;
					}
				}
			}
		}

		atn.ruleToStopState = new Array<RuleStopState>(nrules);
		for (let state of atn.states) {
			if (!(state instanceof RuleStopState)) {
				continue;
			}

			atn.ruleToStopState[state.ruleIndex] = state;
			atn.ruleToStartState[state.ruleIndex].stopState = state;
		}

		//
		// MODES
		//
		let nmodes: number = ATNDeserializer.toInt(data[p++]);
		for (let i = 0; i < nmodes; i++) {
			let s: number = ATNDeserializer.toInt(data[p++]);
			atn.modeToStartState.push(<TokensStartState>atn.states[s]);
		}

		atn.modeToDFA = new Array<DFA>(nmodes);
		for (let i = 0; i < nmodes; i++) {
			atn.modeToDFA[i] = new DFA(atn.modeToStartState[i]);
		}

		//
		// SETS
		//
		let sets: IntervalSet[] = [];
		p = this.readSets2(data, p, sets, false);

		// Next, if the ATN was serialized with the Unicode SMP feature,
		// deserialize sets with 32-bit arguments <= U+10FFFF.
		if (this.isFeatureSupported(CompatibleATNDeserializer.ADDED_UNICODE_SMP2, uuid)) {
			p = this.readSets2(data, p, sets, true);
		}

		//
		// EDGES
		//
		let nedges: number = ATNDeserializer.toInt(data[p++]);
		for (let i = 0; i < nedges; i++) {
			let src: number = ATNDeserializer.toInt(data[p]);
			let trg: number = ATNDeserializer.toInt(data[p + 1]);
			let ttype: number = ATNDeserializer.toInt(data[p + 2]);
			let arg1: number = ATNDeserializer.toInt(data[p + 3]);
			let arg2: number = ATNDeserializer.toInt(data[p + 4]);
			let arg3: number = ATNDeserializer.toInt(data[p + 5]);
			let trans: Transition = this.edgeFactory(atn, ttype, src, trg, arg1, arg2, arg3, sets);
			// console.log(`EDGE ${trans.constructor.name} ${src}->${trg} ${Transition.serializationNames[ttype]} ${arg1},${arg2},${arg3}`);
			let srcState: ATNState = atn.states[src];
			srcState.addTransition(trans);
			p += 6;
		}

		// edges for rule stop states can be derived, so they aren't serialized
		type T = { stopState: number, returnState: number, outermostPrecedenceReturn: number };
		let returnTransitionsSet = new Array2DHashSet<T>({
			hashCode: (o: T) => o.stopState ^ o.returnState ^ o.outermostPrecedenceReturn,

			equals: function (a: T, b: T): boolean {
				return a.stopState === b.stopState
					&& a.returnState === b.returnState
					&& a.outermostPrecedenceReturn === b.outermostPrecedenceReturn;
			}
		});
		let returnTransitions: T[] = [];
		for (let state of atn.states) {
			let returningToLeftFactored: boolean = state.ruleIndex >= 0 && atn.ruleToStartState[state.ruleIndex].leftFactored;
			for (let i = 0; i < state.numberOfTransitions; i++) {
				let t: Transition = state.transition(i);
				if (!(t instanceof RuleTransition)) {
					continue;
				}

				let ruleTransition: RuleTransition = t;
				let returningFromLeftFactored: boolean = atn.ruleToStartState[ruleTransition.target.ruleIndex].leftFactored;
				if (!returningFromLeftFactored && returningToLeftFactored) {
					continue;
				}

				let outermostPrecedenceReturn: number = -1;
				if (atn.ruleToStartState[ruleTransition.target.ruleIndex].isPrecedenceRule) {
					if (ruleTransition.precedence === 0) {
						outermostPrecedenceReturn = ruleTransition.target.ruleIndex;
					}
				}

				let current = { stopState: ruleTransition.target.ruleIndex, returnState: ruleTransition.followState.stateNumber, outermostPrecedenceReturn: outermostPrecedenceReturn };
				if (returnTransitionsSet.add(current)) {
					returnTransitions.push(current);
				}
			}
		}

		// Add all elements from returnTransitions to the ATN
		for (let returnTransition of returnTransitions) {
			let transition = new EpsilonTransition(atn.states[returnTransition.returnState], returnTransition.outermostPrecedenceReturn);
			atn.ruleToStopState[returnTransition.stopState].addTransition(transition);
		}

		for (let state of atn.states) {
			if (state instanceof BlockStartState) {
				// we need to know the end state to set its start state
				if (state.endState == null) {
					throw new Error("IllegalStateException");
				}

				// block end states can only be associated to a single block start state
				if (state.endState.startState != null) {
					throw new Error("IllegalStateException");
				}

				state.endState.startState = state;
			}

			if (state instanceof PlusLoopbackState) {
				let loopbackState: PlusLoopbackState = state;
				for (let i = 0; i < loopbackState.numberOfTransitions; i++) {
					let target: ATNState = loopbackState.transition(i).target;
					if (target instanceof PlusBlockStartState) {
						target.loopBackState = loopbackState;
					}
				}
			}
			else if (state instanceof StarLoopbackState) {
				let loopbackState: StarLoopbackState = state;
				for (let i = 0; i < loopbackState.numberOfTransitions; i++) {
					let target: ATNState = loopbackState.transition(i).target;
					if (target instanceof StarLoopEntryState) {
						target.loopBackState = loopbackState;
					}
				}
			}
		}

		//
		// DECISIONS
		//
		let ndecisions: number = ATNDeserializer.toInt(data[p++]);
		for (let i = 1; i <= ndecisions; i++) {
			let s: number = ATNDeserializer.toInt(data[p++]);
			let decState: DecisionState = <DecisionState>atn.states[s];
			atn.decisionToState.push(decState);
			decState.decision = i - 1;
		}

		//
		// LEXER ACTIONS
		//
		if (atn.grammarType === ATNType.LEXER) {
			if (supportsLexerActions) {
				atn.lexerActions = new Array<LexerAction>(ATNDeserializer.toInt(data[p++]));
				for (let i = 0; i < atn.lexerActions.length; i++) {
					let actionType: LexerActionType = ATNDeserializer.toInt(data[p++]);
					let data1: number = ATNDeserializer.toInt(data[p++]);
					if (data1 == 0xFFFF) {
						data1 = -1;
					}

					let data2: number = ATNDeserializer.toInt(data[p++]);
					if (data2 == 0xFFFF) {
						data2 = -1;
					}

					let lexerAction: LexerAction = this.lexerActionFactory(actionType, data1, data2);

					atn.lexerActions[i] = lexerAction;
				}
			}
			else {
				// for compatibility with older serialized ATNs, convert the old
				// serialized action index for action transitions to the new
				// form, which is the index of a LexerCustomAction
				let legacyLexerActions: LexerAction[] = [];
				for (let state of atn.states) {
					for (let i = 0; i < state.numberOfTransitions; i++) {
						let transition: Transition = state.transition(i);
						if (!(transition instanceof ActionTransition)) {
							continue;
						}

						let ruleIndex: number = transition.ruleIndex;
						let actionIndex: number = transition.actionIndex;
						let lexerAction: LexerCustomAction = new LexerCustomAction(ruleIndex, actionIndex);
						state.setTransition(i, new ActionTransition(transition.target, ruleIndex, legacyLexerActions.length, false));
						legacyLexerActions.push(lexerAction);
					}
				}

				atn.lexerActions = legacyLexerActions;
			}
		}

		this.markPrecedenceDecisions(atn);

		atn.decisionToDFA = new Array<DFA>(ndecisions);
		for (let i = 0; i < ndecisions; i++) {
			atn.decisionToDFA[i] = new DFA(atn.decisionToState[i], i);
		}

		if (this.deserializationOptions2.isVerifyATN) {
			this.verifyATN(atn);
		}

		if (this.deserializationOptions2.isGenerateRuleBypassTransitions && atn.grammarType === ATNType.PARSER) {
			atn.ruleToTokenType = new Int32Array(atn.ruleToStartState.length);
			for (let i = 0; i < atn.ruleToStartState.length; i++) {
				atn.ruleToTokenType[i] = atn.maxTokenType + i + 1;
			}

			for (let i = 0; i < atn.ruleToStartState.length; i++) {
				let bypassStart: BasicBlockStartState = new BasicBlockStartState();
				bypassStart.ruleIndex = i;
				atn.addState(bypassStart);

				let bypassStop: BlockEndState = new BlockEndState();
				bypassStop.ruleIndex = i;
				atn.addState(bypassStop);

				bypassStart.endState = bypassStop;
				atn.defineDecisionState(bypassStart);

				bypassStop.startState = bypassStart;

				let endState: ATNState | undefined;
				let excludeTransition: Transition | undefined;
				if (atn.ruleToStartState[i].isPrecedenceRule) {
					// wrap from the beginning of the rule to the StarLoopEntryState
					endState = undefined;
					for (let state of atn.states) {
						if (state.ruleIndex !== i) {
							continue;
						}

						if (!(state instanceof StarLoopEntryState)) {
							continue;
						}

						let maybeLoopEndState: ATNState = state.transition(state.numberOfTransitions - 1).target;
						if (!(maybeLoopEndState instanceof LoopEndState)) {
							continue;
						}

						if (maybeLoopEndState.epsilonOnlyTransitions && maybeLoopEndState.transition(0).target instanceof RuleStopState) {
							endState = state;
							break;
						}
					}

					if (!endState) {
						throw new Error("Couldn't identify final state of the precedence rule prefix section.");
					}

					excludeTransition = (<StarLoopEntryState>endState).loopBackState.transition(0);
				}
				else {
					endState = atn.ruleToStopState[i];
				}

				// all non-excluded transitions that currently target end state need to target blockEnd instead
				for (let state of atn.states) {
					for (let i = 0; i < state.numberOfTransitions; i++) {
						let transition = state.transition(i);
						if (transition === excludeTransition) {
							continue;
						}

						if (transition.target === endState) {
							transition.target = bypassStop;
						}
					}
				}

				// all transitions leaving the rule start state need to leave blockStart instead
				while (atn.ruleToStartState[i].numberOfTransitions > 0) {
					let transition: Transition = atn.ruleToStartState[i].removeTransition(atn.ruleToStartState[i].numberOfTransitions - 1);
					bypassStart.addTransition(transition);
				}

				// link the new states
				atn.ruleToStartState[i].addTransition(new EpsilonTransition(bypassStart));
				bypassStop.addTransition(new EpsilonTransition(endState));

				let matchState: ATNState = new BasicState();
				atn.addState(matchState);
				matchState.addTransition(new AtomTransition(bypassStop, atn.ruleToTokenType[i]));
				bypassStart.addTransition(new EpsilonTransition(matchState));
			}

			if (this.deserializationOptions2.isVerifyATN) {
				// reverify after modification
				this.verifyATN(atn);
			}
		}

		if (this.deserializationOptions2.isOptimize) {
			while (true) {
				let optimizationCount: number = 0;
				optimizationCount += CompatibleATNDeserializer.inlineSetRules2(atn);
				optimizationCount += CompatibleATNDeserializer.combineChainedEpsilons2(atn);
				let preserveOrder: boolean = atn.grammarType === ATNType.LEXER;
				optimizationCount += CompatibleATNDeserializer.optimizeSets2(atn, preserveOrder);
				if (optimizationCount === 0) {
					break;
				}
			}

			if (this.deserializationOptions2.isVerifyATN) {
				// reverify after modification
				this.verifyATN(atn);
			}
		}

		CompatibleATNDeserializer.identifyTailCalls2(atn);

		return atn;
	}

	private readSets2(data: Uint16Array, p: number, sets: IntervalSet[], read32: boolean): number {
		let nsets: number = ATNDeserializer.toInt(data[p++]);
		for (let i = 0; i < nsets; i++) {
			let nintervals: number = ATNDeserializer.toInt(data[p]);
			p++;
			let set: IntervalSet = new IntervalSet();
			sets.push(set);

			let containsEof: boolean = ATNDeserializer.toInt(data[p++]) != 0;
			if (containsEof) {
				set.add(-1);
			}

			if (read32) {
				for (let j = 0; j < nintervals; j++) {
					set.add(ATNDeserializer.toInt32(data, p), ATNDeserializer.toInt32(data, p + 2));
					p += 4;
				}
			} else {
				for (let j = 0; j < nintervals; j++) {
					set.add(ATNDeserializer.toInt(data[p]), ATNDeserializer.toInt(data[p + 1]));
					p += 2;
				}
			}
		}

		return p;
	}

	private static inlineSetRules2(atn: ATN): number {
		let inlinedCalls: number = 0;

		let ruleToInlineTransition: Transition[] = new Array<Transition>(atn.ruleToStartState.length);
		for (let i = 0; i < atn.ruleToStartState.length; i++) {
			let startState: RuleStartState = atn.ruleToStartState[i];
			let middleState: ATNState = startState;
			while (middleState.onlyHasEpsilonTransitions
				&& middleState.numberOfOptimizedTransitions === 1
				&& middleState.getOptimizedTransition(0).serializationType === TransitionType.EPSILON) {
				middleState = middleState.getOptimizedTransition(0).target;
			}

			if (middleState.numberOfOptimizedTransitions !== 1) {
				continue;
			}

			let matchTransition: Transition = middleState.getOptimizedTransition(0);
			let matchTarget: ATNState = matchTransition.target;
			if (matchTransition.isEpsilon
				|| !matchTarget.onlyHasEpsilonTransitions
				|| matchTarget.numberOfOptimizedTransitions !== 1
				|| !(matchTarget.getOptimizedTransition(0).target instanceof RuleStopState)) {
				continue;
			}

			switch (matchTransition.serializationType) {
			case TransitionType.ATOM:
			case TransitionType.RANGE:
			case TransitionType.SET:
				ruleToInlineTransition[i] = matchTransition;
				break;

			case TransitionType.NOT_SET:
			case TransitionType.WILDCARD:
				// not implemented yet
				continue;

			default:
				continue;
			}
		}

		for (let stateNumber = 0; stateNumber < atn.states.length; stateNumber++) {
			let state: ATNState = atn.states[stateNumber];
			if (state.ruleIndex < 0) {
				continue;
			}

			let optimizedTransitions: Transition[] | undefined;
			for (let i = 0; i < state.numberOfOptimizedTransitions; i++) {
				let transition: Transition = state.getOptimizedTransition(i);
				if (!(transition instanceof RuleTransition)) {
					if (optimizedTransitions != null) {
						optimizedTransitions.push(transition);
					}

					continue;
				}

				let ruleTransition: RuleTransition = transition;
				let effective: Transition = ruleToInlineTransition[ruleTransition.target.ruleIndex];
				if (effective == null) {
					if (optimizedTransitions != null) {
						optimizedTransitions.push(transition);
					}

					continue;
				}

				if (optimizedTransitions == null) {
					optimizedTransitions = [];
					for (let j = 0; j < i; j++) {
						optimizedTransitions.push(state.getOptimizedTransition(i));
					}
				}

				inlinedCalls++;
				let target: ATNState = ruleTransition.followState;
				let intermediateState: ATNState = new BasicState();
				intermediateState.setRuleIndex(target.ruleIndex);
				atn.addState(intermediateState);
				optimizedTransitions.push(new EpsilonTransition(intermediateState));

				switch (effective.serializationType) {
				case TransitionType.ATOM:
					intermediateState.addTransition(new AtomTransition(target, (<AtomTransition>effective)._label));
					break;

				case TransitionType.RANGE:
					intermediateState.addTransition(new RangeTransition(target, (<RangeTransition>effective).from, (<RangeTransition>effective).to));
					break;

				case TransitionType.SET:
					intermediateState.addTransition(new SetTransition(target, (<SetTransition>effective).label));
					break;

				default:
					throw new Error("UnsupportedOperationException");
				}
			}

			if (optimizedTransitions != null) {
				if (state.isOptimized) {
					while (state.numberOfOptimizedTransitions > 0) {
						state.removeOptimizedTransition(state.numberOfOptimizedTransitions - 1);
					}
				}

				for (let transition of optimizedTransitions) {
					state.addOptimizedTransition(transition);
				}
			}
		}

		if (ParserATNSimulator.debug) {
			console.log("ATN runtime optimizer removed " + inlinedCalls + " rule invocations by inlining sets.");
		}

		return inlinedCalls;
	}

	private static combineChainedEpsilons2(atn: ATN): number {
		let removedEdges: number = 0;

		for (let state of atn.states) {
			if (!state.onlyHasEpsilonTransitions || state instanceof RuleStopState) {
				continue;
			}

			let optimizedTransitions: Transition[] | undefined;
			nextTransition:
			for (let i = 0; i < state.numberOfOptimizedTransitions; i++) {
				let transition: Transition = state.getOptimizedTransition(i);
				let intermediate: ATNState = transition.target;
				if (transition.serializationType !== TransitionType.EPSILON
					|| (<EpsilonTransition>transition).outermostPrecedenceReturn !== -1
					|| intermediate.stateType !== ATNStateType.BASIC
					|| !intermediate.onlyHasEpsilonTransitions) {
					if (optimizedTransitions != null) {
						optimizedTransitions.push(transition);
					}

					continue nextTransition;
				}

				for (let j = 0; j < intermediate.numberOfOptimizedTransitions; j++) {
					if (intermediate.getOptimizedTransition(j).serializationType !== TransitionType.EPSILON
						|| (<EpsilonTransition>intermediate.getOptimizedTransition(j)).outermostPrecedenceReturn !== -1) {
						if (optimizedTransitions != null) {
							optimizedTransitions.push(transition);
						}

						continue nextTransition;
					}
				}

				removedEdges++;
				if (optimizedTransitions == null) {
					optimizedTransitions = [];
					for (let j = 0; j < i; j++) {
						optimizedTransitions.push(state.getOptimizedTransition(j));
					}
				}

				for (let j = 0; j < intermediate.numberOfOptimizedTransitions; j++) {
					let target: ATNState = intermediate.getOptimizedTransition(j).target;
					optimizedTransitions.push(new EpsilonTransition(target));
				}
			}

			if (optimizedTransitions != null) {
				if (state.isOptimized) {
					while (state.numberOfOptimizedTransitions > 0) {
						state.removeOptimizedTransition(state.numberOfOptimizedTransitions - 1);
					}
				}

				for (let transition of optimizedTransitions) {
					state.addOptimizedTransition(transition);
				}
			}
		}

		if (ParserATNSimulator.debug) {
			console.log("ATN runtime optimizer removed " + removedEdges + " transitions by combining chained epsilon transitions.");
		}

		return removedEdges;
	}

	private static optimizeSets2(atn: ATN, preserveOrder: boolean): number {
		if (preserveOrder) {
			// this optimization currently doesn't preserve edge order.
			return 0;
		}

		let removedPaths: number = 0;
		let decisions: DecisionState[] = atn.decisionToState;
		for (let decision of decisions) {
			let setTransitions: IntervalSet = new IntervalSet();
			for (let i = 0; i < decision.numberOfOptimizedTransitions; i++) {
				let epsTransition: Transition = decision.getOptimizedTransition(i);
				if (!(epsTransition instanceof EpsilonTransition)) {
					continue;
				}

				if (epsTransition.target.numberOfOptimizedTransitions !== 1) {
					continue;
				}

				let transition: Transition = epsTransition.target.getOptimizedTransition(0);
				if (!(transition.target instanceof BlockEndState)) {
					continue;
				}

				if (transition instanceof NotSetTransition) {
					// TODO: not yet implemented
					continue;
				}

				if (transition instanceof AtomTransition
					|| transition instanceof RangeTransition
					|| transition instanceof SetTransition) {
					setTransitions.add(i);
				}
			}

			if (setTransitions.size <= 1) {
				continue;
			}

			let optimizedTransitions: Transition[] = [];
			for (let i = 0; i < decision.numberOfOptimizedTransitions; i++) {
				if (!setTransitions.contains(i)) {
					optimizedTransitions.push(decision.getOptimizedTransition(i));
				}
			}

			let blockEndState: ATNState = decision.getOptimizedTransition(setTransitions.minElement).target.getOptimizedTransition(0).target;
			let matchSet: IntervalSet = new IntervalSet();
			for (let i = 0; i < setTransitions.intervals.length; i++) {
				let interval: Interval = setTransitions.intervals[i];
				for (let j = interval.a; j <= interval.b; j++) {
					let matchTransition: Transition = decision.getOptimizedTransition(j).target.getOptimizedTransition(0);
					if (matchTransition instanceof NotSetTransition) {
						throw new Error("Not yet implemented.");
					} else {
						matchSet.addAll(<IntervalSet>matchTransition.label);
					}
				}
			}

			let newTransition: Transition;
			if (matchSet.intervals.length === 1) {
				if (matchSet.size === 1) {
					newTransition = new AtomTransition(blockEndState, matchSet.minElement);
				} else {
					let matchInterval: Interval = matchSet.intervals[0];
					newTransition = new RangeTransition(blockEndState, matchInterval.a, matchInterval.b);
				}
			} else {
				newTransition = new SetTransition(blockEndState, matchSet);
			}

			let setOptimizedState: ATNState = new BasicState();
			setOptimizedState.setRuleIndex(decision.ruleIndex);
			atn.addState(setOptimizedState);

			setOptimizedState.addTransition(newTransition);
			optimizedTransitions.push(new EpsilonTransition(setOptimizedState));

			removedPaths += decision.numberOfOptimizedTransitions - optimizedTransitions.length;

			if (decision.isOptimized) {
				while (decision.numberOfOptimizedTransitions > 0) {
					decision.removeOptimizedTransition(decision.numberOfOptimizedTransitions - 1);
				}
			}

			for (let transition of optimizedTransitions) {
				decision.addOptimizedTransition(transition);
			}
		}

		if (ParserATNSimulator.debug) {
			console.log("ATN runtime optimizer removed " + removedPaths + " paths by collapsing sets.");
		}

		return removedPaths;
	}

	private static identifyTailCalls2(atn: ATN): void {
		for (let state of atn.states) {
			for (let i = 0; i < state.numberOfTransitions; i++) {
				let transition = state.transition(i);
				if (!(transition instanceof RuleTransition)) {
					continue;
				}

				transition.tailCall = this.testTailCall2(atn, transition, false);
				transition.optimizedTailCall = this.testTailCall2(atn, transition, true);
			}

			if (!state.isOptimized) {
				continue;
			}

			for (let i = 0; i < state.numberOfOptimizedTransitions; i++) {
				let transition = state.getOptimizedTransition(i);
				if (!(transition instanceof RuleTransition)) {
					continue;
				}

				transition.tailCall = this.testTailCall2(atn, transition, false);
				transition.optimizedTailCall = this.testTailCall2(atn, transition, true);
			}
		}
	}

	private static testTailCall2(atn: ATN, transition: RuleTransition, optimizedPath: boolean): boolean {
		if (!optimizedPath && transition.tailCall) {
			return true;
		}
		if (optimizedPath && transition.optimizedTailCall) {
			return true;
		}

		let reachable: BitSet = new BitSet(atn.states.length);
		let worklist: ATNState[] = [];
		worklist.push(transition.followState);
		while (true) {
			let state = worklist.pop();
			if (!state) {
				break;
			}

			if (reachable.get(state.stateNumber)) {
				continue;
			}

			if (state instanceof RuleStopState) {
				continue;
			}

			if (!state.onlyHasEpsilonTransitions) {
				return false;
			}

			let transitionCount = optimizedPath ? state.numberOfOptimizedTransitions : state.numberOfTransitions;
			for (let i = 0; i < transitionCount; i++) {
				let t = optimizedPath ? state.getOptimizedTransition(i) : state.transition(i);
				if (t.serializationType !== TransitionType.EPSILON) {
					return false;
				}

				worklist.push(t.target);
			}
		}

		return true;
	}
}
