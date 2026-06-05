package com.shmamsa.validation.customAnnotation;

import com.shmamsa.util.NationalIdUtils;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.time.LocalDate;
import java.time.Period;

public class NationalIdValidator implements ConstraintValidator<ValidNationalId, String> {

    private int minAge;

    @Override
    public void initialize(ValidNationalId constraintAnnotation) {
        this.minAge = constraintAnnotation.minAge();
    }

    @Override
    public boolean isValid(String nid, ConstraintValidatorContext context) {
        if (nid == null || nid.isBlank()) return true;

        if (!nid.matches("\\d{14}"))
            return false;

        if (nid.matches("(\\d)\\1{13}"))
            return false;

        LocalDate birthDate = NationalIdUtils.extractBirthDate(nid);
        if (birthDate == null) return false;

        if (birthDate.isAfter(LocalDate.now()))
            return false;

        int age = Period.between(birthDate, LocalDate.now()).getYears();
        return age >= minAge;
    }
}
