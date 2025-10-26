package com.shmamsa.model;

import com.shmamsa.validation.customAnnotation.DifferentParentPhones;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.time.LocalDate;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@DifferentParentPhones // custom validator (see below)
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "Username is required")
    @Column(nullable = false, unique = true)
    private String username;

    @NotBlank(message = "Password is required")
    @Column(nullable = false)
    private String password;

    private String role = "USER";

    @Pattern(regexp = "\\d{11}", message = "Phone number must be 11 digits")
    @Column(length = 15)
    private String phoneNumber;

    @NotBlank(message = "National ID is required")
    @Size(min = 14, max = 14, message = "National ID must be exactly 14 digits")
    @Pattern(regexp = "\\d{14}", message = "National ID must contain only numbers")
    @Column(length = 20, unique = true)
    private String nationalId;

    private LocalDate dateOfBirth;

    @Pattern(regexp = "\\d{11}", message = "Father phone must be 11 digits")
    @Column(length = 15)
    private String fatherPhone;

    @Pattern(regexp = "\\d{11}", message = "Mother phone must be 11 digits")
    @Column(length = 15)
    private String motherPhone;

    @Column(length = 100)
    private String motherJob;

    @Column(length = 100)
    private String fatherJob;
}
