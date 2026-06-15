package com.shmamsa.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public class ForgotPasswordRequest {

    @NotBlank(message = "رقم الهاتف مطلوب")
    @Pattern(regexp = "\\d{11}", message = "رقم الهاتف يجب أن يكون 11 رقم")
    private String phoneNumber;

    public ForgotPasswordRequest() {}

    public String getPhoneNumber() { return phoneNumber; }
    public void setPhoneNumber(String phoneNumber) { this.phoneNumber = phoneNumber; }
}
