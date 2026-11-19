/**
 * Logs the error and, when the page has a body, shows a short message in it.
 * Always returns null so callers can `return reportError(...)`.
 */
export function reportError(error: any): any;
export const ErrorCode: Readonly<{
    UNDEFINED: 0;
    WRONG_INPUT_TYPE: 1;
    NO_BODY_OR_PARENT: 2;
}>;
export function undefinedError(variable: any, functionName: any): {
    errorCode: 0;
    errorString: string;
    errorVariable: any;
    errorFunction: any;
};
export function wrongInputTypeError(variable: any, functionName: any, inputOptions: any): {
    errorCode: 1;
    errorString: string;
    errorVariable: any;
    errorFunction: any;
    errorMiscInfo: any;
};
export function noBodyOrParentError(variable: any, functionName: any): {
    errorCode: 2;
    errorString: string;
    errorVariable: any;
    errorFunction: any;
};
