/*
 * The MIT License (MIT)
 * http://opensource.org/licenses/MIT
 *
 * Copyright (c) 2014 Bart Kiers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
*/

/*
 * Translated to TS and modified by
 * Copyright (c) 2017, Mike Lischke
 * under the MIT license.
 *
 * See LICENSE file for more info.
 */

"use strict";

import { AbstractParseTreeVisitor, TerminalNode, ParseTree } from "antlr4ts/tree";
import { ANTLRv4ParserVisitor } from "../parser/ANTLRv4ParserVisitor";
import { ANTLRv4Lexer } from "../parser/ANTLRv4Lexer";
import {
    ANTLRv4Parser, ParserRuleSpecContext, RuleAltListContext, LexerRuleSpecContext, LexerAltListContext, LexerAltContext,
    LexerElementsContext, LexerElementContext, LabeledLexerElementContext, AltListContext, AlternativeContext,
    ElementContext, LabeledElementContext, EbnfContext, EbnfSuffixContext, LexerAtomContext, AtomContext,
    NotSetContext, BlockSetContext, CharacterRangeContext, TerminalRuleContext, SetElementContext,

    RuleBlockContext, LexerRuleBlockContext
} from "../parser/ANTLRv4Parser";

export class RuleVisitor extends AbstractParseTreeVisitor<string> implements ANTLRv4ParserVisitor<string> {

    constructor(private scripts: Map<string, string>) {
        super();
    }

    defaultResult(): string {
        return "";
    }

    visitParserRuleSpec(ctx: ParserRuleSpecContext): string {
        if (!ctx.tryGetRuleContext(0, RuleBlockContext)) {
            return "# Syntax Error #";
        }

        let diagram = "ComplexDiagram(" + this.visitRuleAltList(ctx.ruleBlock().ruleAltList()) + ").addTo()";
        this.scripts.set(ctx.RULE_REF().text, diagram);

        return diagram;
    }

    visitRuleAltList = function(ctx: RuleAltListContext): string {
        let script = "Choice(0";
        let alternatives = ctx.labeledAlt();
        for (let alternative of alternatives) {
            script += ", " + this.visitAlternative(alternative.alternative());
        }

        return script + ")";
    }

    visitLexerRuleSpec = function(ctx: LexerRuleSpecContext): string {
        if (!ctx.tryGetRuleContext(0, LexerRuleBlockContext)) {
            return "# Syntax Error #";
        }

        let diagram = "Diagram(" + this.visitLexerAltList(ctx.lexerRuleBlock()!.lexerAltList()) + ").addTo()";

        this.scripts.set(ctx.TOKEN_REF().text, diagram);

        return diagram;
    }

    visitLexerAltList = function(ctx: LexerAltListContext): string {
        let script = "Choice(0";

        for (let alternative of ctx.lexerAlt()) {
            script += ", " + this.visitLexerAlt(alternative);
        }

        return script + ")";
    }

    visitLexerAlt = function(ctx: LexerAltContext) {
        if (ctx.lexerElements()) {
            return this.visitLexerElements(ctx.lexerElements()!);
        } else {
            return "Comment('&#949;')"; // Epsilon
        }
    }

    visitLexerElements = function(ctx: LexerElementsContext) {
        let script = "";

        for (let element of ctx.lexerElement()) {
            if (script.length > 0) {
                script += ", "
            }
            script += this.visitLexerElement(element);
        }

        return "Sequence(" + script + ")";
    }

    visitLexerElement = function(ctx: LexerElementContext) {
        let hasEbnfSuffix = (ctx.ebnfSuffix() != undefined);

        if (ctx.labeledLexerElement()) {
            if (hasEbnfSuffix) {
                return this.visitEbnfSuffix(ctx.ebnfSuffix()!) + "(" + this.visitLabeledLexerElement(ctx.labeledLexerElement()!) + ")";
            } else {
                return this.visitLabeledLexerElement(ctx.labeledLexerElement()!);
            }
        } else if (ctx.lexerAtom()) {
            if (hasEbnfSuffix) {
                return this.visitEbnfSuffix(ctx.ebnfSuffix()!) + "(" + this.visitLexerAtom(ctx.lexerAtom()!) + ")";
            } else {
                return this.visitLexerAtom(ctx.lexerAtom()!);
            }
        } else if (ctx.lexerBlock()) {
            if (hasEbnfSuffix) {
                return this.visitEbnfSuffix(ctx.ebnfSuffix()!) + "(" + this.visitLexerAltList(ctx.lexerBlock()!.lexerAltList()) + ")";
            } else {
                return this.visitLexerAltList(ctx.lexerBlock()!.lexerAltList());
            }
        }

        return "Comment('&#949;')";
    }

    visitLabeledLexerElement = function(ctx: LabeledLexerElementContext) {
        if (ctx.lexerAtom()) {
            return this.visitLexerAtom(ctx.lexerAtom()!);
        } else {
            return this.visitAltList(ctx.block()!.altList());
        }
    }

    visitAltList = function(ctx: AltListContext) {
        let script = "Choice(0";
        for (let alternative of ctx.alternative()) {
            script += ", " + this.visitAlternative(alternative);
        }

        return script + ")";
    }

    visitAlternative = function(ctx: AlternativeContext) {
        if (ctx.element()) {
            let script = "";
            for (let element of ctx.element()) {
                if (script.length > 0) {
                    script += ", ";
                }
                script += this.visitElement(element);
            }
            return "Sequence(" + script + ")";
        } else {
            return "Comment('&#949;')";
        }
    }

    visitElement = function(ctx: ElementContext) {
        let hasEbnfSuffix = (ctx.ebnfSuffix() != undefined);

        if (ctx.labeledElement()) {
            if (hasEbnfSuffix) {
                return this.visitEbnfSuffix(ctx.ebnfSuffix()!) + "(" + this.visitLabeledElement(ctx.labeledElement()!) + ")";
            } else {
                return this.visitLabeledElement(ctx.labeledElement()!);
            }
        } else if (ctx.atom()) {
            if (hasEbnfSuffix) {
                return this.visitEbnfSuffix(ctx.ebnfSuffix()!) + "(" + this.visitAtom(ctx.atom()!) + ")";
            } else {
                return this.visitAtom(ctx.atom()!);
            }
        } else if (ctx.ebnf()) {
            return this.visitEbnf(ctx.ebnf()!);
        } else if (ctx.QUESTION()) {
            return "Comment('predicate')";
        } else {
            return "Comment('&#949;')";
        }
    }


    visitLabeledElement = function(ctx: LabeledElementContext) {
        if (ctx.atom()) {
            return this.visitAtom(ctx.atom()!);
        } else {
            return this.visitAltList(ctx.block()!.altList());
        }
    }

    visitEbnf = function(ctx: EbnfContext) {
        if (!ctx.block()) {
            return "# Syntax Error #";
        }

        if (ctx.blockSuffix()) {
            return this.visitEbnfSuffix(ctx.blockSuffix()!.ebnfSuffix()) + "(" + this.visitAltList(ctx.block()!.altList()) + ")";
        } else {
            return this.visitAltList(ctx.block()!.altList());
        }
    }

    visitEbnfSuffix = function(ctx: EbnfSuffixContext) {
        let text = ctx.text;

        if (text === "?") {
            return "Optional";
        } else if (text === "*") {
            return "ZeroOrMore";
        } else {
            return "OneOrMore";
        }
    }

    visitLexerAtom = function(ctx: LexerAtomContext) {
        if (ctx.characterRange()) {
            return this.visitCharacterRange(ctx.characterRange()!);
        } else if (ctx.terminalRule()) {
            return this.visitTerminalRule(ctx.terminalRule()!);
        } else if (ctx.notSet()) {
            return this.visitNotSet(ctx.notSet()!);
        } else if (ctx.LEXER_CHAR_SET()) {
            return this.visitTerminal(ctx.LEXER_CHAR_SET()!);
        }

        return "Terminal('any char')";
    }

    visitAtom = function(ctx: AtomContext) {
        if (ctx.characterRange()) {
            return this.visitCharacterRange(ctx.characterRange()!);
        }
        else if (ctx.terminalRule()) {
            return this.visitTerminalRule(ctx.terminalRule()!);
        }
        else if (ctx.ruleref()) {
            return this.visitTerminal(ctx.ruleref()!.RULE_REF());
        }
        else if (ctx.notSet()) {
            return this.visitNotSet(ctx.notSet()!);
        }
        else {
            return "NonTerminal('any token')";
        }
    }

    visitNotSet = function(ctx: NotSetContext) {
        if (ctx.setElement() != null) {
            return "Sequence(Comment('not'), " + this.visitSetElement(ctx.setElement()!) + ")";
        } else {
            return "Sequence(Comment('not'), " + this.visitBlockSet(ctx.blockSet()!) + ")";
        }
    }

    visitBlockSet = function(ctx: BlockSetContext) {
        let script = "Choice(0";
        for (let element of ctx.setElement()) {
            script += ", " + this.visitSetElement(element);
        }

        return script + ")";
    }

    visitSetElement = function(ctx: SetElementContext): string {
        if (ctx.characterRange()) {
            return this.visitCharacterRange(ctx.characterRange()!);
        } else if (ctx.TOKEN_REF()) {
            return this.visitTerminal(ctx.TOKEN_REF()!);
        } else if (ctx.STRING_LITERAL()) {
            return this.visitTerminal(ctx.STRING_LITERAL()!);
        }

        return this.visitTerminal(ctx.LEXER_CHAR_SET()!);
    }

    visitCharacterRange = function(ctx: CharacterRangeContext) {
        return this.escapeTerminal(ctx.STRING_LITERAL(0)) + " .. " + this.escapeTerminal(ctx.STRING_LITERAL(1))
    }

    visitTerminalRule = function(ctx: TerminalRuleContext) {
        if (ctx.TOKEN_REF()) {
            return this.visitTerminal(ctx.TOKEN_REF()!);
        } else {
            return this.visitTerminal(ctx.STRING_LITERAL()!);
        }
    }

    visitTerminal(node: TerminalNode) {
        switch (node.symbol.type) {
            case ANTLRv4Lexer.STRING_LITERAL:
            case ANTLRv4Lexer.LEXER_CHAR_SET:
                return "Terminal('" + this.escapeTerminal(node) + "')";

            case ANTLRv4Lexer.TOKEN_REF:
                return "Terminal('" + node.text + "')";

            default:
                return "NonTerminal('" + node.text + "')";
        }
    }

    private escapeTerminal(node: TerminalNode): string {
        let text = node.text;
        let escaped = text.replace("\\u", "\\\\u");

        switch (node.symbol.type) {
            case ANTLRv4Lexer.STRING_LITERAL:
                return "\\'" + escaped.substring(1, escaped.length - 1) + "\\'";
            default:
                return escaped.replace("'", "\\'");
        }
    }
}
