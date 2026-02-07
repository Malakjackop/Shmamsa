package com.shmamsa.exception;

import org.springframework.http.HttpStatus;

/**
 * A small, explicit exception for predictable (client-facing) API errors.
 * Use this instead of RuntimeException / jakarta.validation.ValidationException.
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String message) {
        this(status, null, message);
    }

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
