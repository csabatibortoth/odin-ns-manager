//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/HTMLElementGenerator

export const ErrorCode = Object.freeze({
    UNDEFINED: 0,
    WRONG_INPUT_TYPE: 1,
    NO_BODY_OR_PARENT: 2,
});

export const undefinedError = (variable, functionName) => ({
    errorCode: ErrorCode.UNDEFINED,
    errorString: 'undefined',
    errorVariable: variable,
    errorFunction: functionName,
});

export const wrongInputTypeError = (variable, functionName, inputOptions) => ({
    errorCode: ErrorCode.WRONG_INPUT_TYPE,
    errorString: 'Wrong Input Type defined',
    errorVariable: variable,
    errorFunction: functionName,
    errorMiscInfo: inputOptions,
});

export const noBodyOrParentError = (variable, functionName) => ({
    errorCode: ErrorCode.NO_BODY_OR_PARENT,
    errorString: 'No body or parent to append input!',
    errorVariable: variable,
    errorFunction: functionName,
});

/**
 * Logs the error and, when the page has a body, shows a short message in it.
 * Always returns null so callers can `return reportError(...)`.
 */
export function reportError(error) {
    console.error(error);
    const { body } = document;
    if (body) {
        const div = document.createElement('div');
        div.textContent = `Error Code: ${error.errorCode}, Error description: ${error.errorString}! For more information see console!`;
        body.append(div);
    }
    return null;
}
