package com.shmamsa.validation.customAnnotation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class DifferentParentPhonesValidator implements ConstraintValidator<DifferentParentPhones, DifferentParentPhonesValidator.HasParentPhones> {

    public interface HasParentPhones {
        String getPhoneNumber();
        String getGuardiansPhone();
    }

    @Override
    public boolean isValid(HasParentPhones value, ConstraintValidatorContext context) {
        if (value == null) return true;

        String guardianPhone = normalize(value.getGuardiansPhone());
        String userPhone = normalize(value.getPhoneNumber());

        if (guardianPhone.isBlank() || userPhone.isBlank()) return true;
        if (!guardianPhone.equals(userPhone)) return true;

        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(context.getDefaultConstraintMessageTemplate())
                .addPropertyNode("guardiansPhone")
                .addConstraintViolation();
        return false;
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
