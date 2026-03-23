package com.shmamsa.validation.customAnnotation;

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

        try {

            int century = switch (nid.charAt(0)) {
                case '2' -> 1900;
                case '3' -> 2000;
                default -> throw new Exception();
            };

            int year = century + Integer.parseInt(nid.substring(1,3));
            int month = Integer.parseInt(nid.substring(3,5));
            int day = Integer.parseInt(nid.substring(5,7));

            LocalDate birthDate = LocalDate.of(year, month, day);

            if (birthDate.isAfter(LocalDate.now()))
                return false;

            int age = Period.between(birthDate, LocalDate.now()).getYears();

            return age >= minAge;

        } catch (Exception e){
            return false;
        }
    }
}
