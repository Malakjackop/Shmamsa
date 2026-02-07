package com.shmamsa.exception;

import java.time.Instant;
import java.util.Map;

/**
 * Standard API error response.
 */
public class ErrorResponse {

    private final Instant timestamp = Instant.now();
    private final int status;
    private final String error;
    private final String code;
    private final Map<String, String> fields;

    public ErrorResponse(int status, String error, String code, Map<String, String> fields) {
        this.status = status;
        this.error = error;
        this.code = code;
        this.fields = fields;
    }

    public Instant getTimestamp() {
        return timestamp;
    }

    public int getStatus() {
        return status;
    }

    public String getError() {
        return error;
    }

    public String getCode() {
        return code;
    }

    public Map<String, String> getFields() {
        return fields;
    }
}
